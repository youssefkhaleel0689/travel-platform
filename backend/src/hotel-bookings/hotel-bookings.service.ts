import {
  BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  GuestType, HotelBooking, HotelBookingDocument, HotelBookingStatus,
} from './schemas/hotel-booking.schema';
import { Room, RoomDocument } from '../rooms/schemas/room.schema';
import {
  BookingGroup, CancelBookingDto, CreateHotelBookingDto, ListBookingsQueryDto, ReservationsQueryDto,
} from './dto/hotel-booking.dto';
import { InventoryService } from '../inventory/inventory.service';
import { HotelPoliciesService } from '../hotel-policies/hotel-policies.service';
import { HotelsService, HotelBrief } from '../hotels/hotels.service';
import { UsersService } from '../auth/users/users.service';
import type { AuthenticatedUser } from '../common/auth/authenticated-user';
import { HOLD_MINUTES, PLATFORM_CURRENCY } from '../common/constants';
import { Role } from '../common/auth/auth.enums';
import { parseStay, todayUtc, DAY_MS } from '../common/dates';
import { centsToDecimal128, centsToString, pickRefundPercentage, refundCents, toCents } from '../common/money';
import { oid } from '../common/mongo';
import { PageDto, PageMetaDto } from '../common/pagination/dto/page.dto';
import { PAGE_SIZE } from '../common/pagination/pagination.constants';
import { HOTEL_NOTIFICATIONS, HOTEL_PAYMENTS } from './hotel-integration.ports';
import type { HotelNotificationsPort, HotelPaymentsPort } from './hotel-integration.ports';

@Injectable()
export class HotelBookingsService {
  private readonly logger = new Logger(HotelBookingsService.name);

  constructor(
    @InjectModel(HotelBooking.name) private readonly bookingModel: Model<HotelBookingDocument>,
    @InjectModel(Room.name) private readonly roomModel: Model<RoomDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: InventoryService,
    private readonly policies: HotelPoliciesService,
    private readonly hotels: HotelsService,
    private readonly users: UsersService,
    @Optional() @Inject(HOTEL_NOTIFICATIONS) private readonly notifications?: HotelNotificationsPort,
    @Optional() @Inject(HOTEL_PAYMENTS) private readonly payments?: HotelPaymentsPort,
  ) {}

  // ---------------------------------------------------------------- HTL-16 / HTL-18: create + hold

  /**
   * Creates ONE reservation for one or more rooms and holds them all together for 10 minutes (PENDING_PAYMENT).
   * Runs in a transaction: any conflict rejects the whole request and nothing is held (no partial holds).
   */
  async createHold(user: AuthenticatedUser, dto: CreateHotelBookingDto) {
    const { checkIn, checkOut, nights } = parseStay(dto.checkInDate, dto.checkOutDate);
    const hotel = await this.hotels.getActiveHotelOrThrow(dto.hotelId);

    const roomIds = dto.rooms.map((r) => oid(r.roomId, 'roomId'));
    if (new Set(roomIds.map(String)).size !== roomIds.length) {
      throw new BadRequestException('The same room cannot be selected twice');
    }

    // Guest rules (HTL-16): >= 1 adult per reservation, children aged 0-17.
    let adultCount = 0;
    let childCount = 0;
    for (const sel of dto.rooms) {
      for (const g of sel.assignedGuests) {
        if (g.type === GuestType.CHILD) {
          if (g.age === undefined || g.age < 0 || g.age > 17) {
            throw new BadRequestException('Every child guest needs an age between 0 and 17');
          }
          childCount++;
        } else {
          if (g.age !== undefined && g.age < 18) throw new BadRequestException('Adult guests must be 18 or older');
          adultCount++;
        }
      }
    }
    if (adultCount < 1) throw new BadRequestException('At least one adult is required per reservation');

    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);

    return this.connection.transaction(async (session: ClientSession) => {
        // 1. serialise against concurrent requests on the same rooms
        await this.inventory.lockRooms(roomIds, session);

        // 2. load rooms, they must all belong to this hotel and be active
        const rooms = await this.roomModel.find({ _id: { $in: roomIds }, hotelId: hotel._id }).session(session).exec();
        if (rooms.length !== roomIds.length) throw new BadRequestException('All rooms must exist and belong to the selected hotel');
        if (rooms.some((r) => !r.isActive)) throw new BadRequestException('One or more selected rooms are not active');

        // 3. whole-stay availability for ALL rooms (blocked / not offered / already reserved or held)
        const status = await this.inventory.evaluateRooms(roomIds, checkIn, checkOut, { session });
        const unavailable = rooms.filter((r) => !status.get(String(r._id))?.free);
        if (unavailable.length) {
          const list = unavailable
            .map((r) => `${r.roomNumber} (${(status.get(String(r._id)) as { reason: string }).reason})`)
            .join(', ');
          throw new ConflictException({
            code: 'ROOM_UNAVAILABLE',
            message: `Not available for the whole stay, nothing was held: room ${list}`,
          });
        }

        // 4. per-room capacity, snapshots and total (sum of nights x booking-time price)
        let total = 0n;
        const snapshots = dto.rooms.map((sel) => {
          const room = rooms.find((r) => String(r._id) === String(oid(sel.roomId)))!;
          if (sel.assignedGuests.length > room.maxOccupancy) {
            throw new BadRequestException(`Room ${room.roomNumber} allows at most ${room.maxOccupancy} guests`);
          }
          const price = toCents(room.pricePerNight);
          const line = price * BigInt(nights);
          total += line;
          return {
            roomId: room._id,
            roomNumberSnapshot: room.roomNumber,
            roomNameSnapshot: room.name,
            roomTypeSnapshot: room.type,
            bedsSnapshot: room.beds,
            maxOccupancySnapshot: room.maxOccupancy,
            pricePerNightSnapshot: centsToDecimal128(price),
            assignedGuests: sel.assignedGuests.map((g) => ({ type: g.type, fullName: g.fullName, age: g.age })),
            nights,
            lineTotal: centsToDecimal128(line),
          };
        });

        // 5. exact policy version snapshot
        const policySnapshot = await this.policies.getSnapshot(hotel._id, session);

        const [created] = await this.bookingModel.create(
          [{
            userId: new Types.ObjectId(user.userId), // always from the session, never from the request body
            hotelId: hotel._id,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            roomsSnapshot: snapshots,
            adultCount,
            childCount,
            totalPrice: centsToDecimal128(total),
            currency: PLATFORM_CURRENCY,
            status: HotelBookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
            policySnapshot,
          }],
          { session },
        );
        return created;
    });
  }

  // ---------------------------------------------------------------- HTL-17: confirm after verified payment

  /**
   * Called by the Payments module ONLY after the backend verified the Stripe PaymentIntent (webhook).
   * `paymentId` is the id of the Payment document (not the Stripe PaymentIntent id). Idempotent.
   * A booking is confirmed only while its hold is still valid (GEN-11, HTL-18) and the policies were accepted (PAY-02).
   * Otherwise nothing is confirmed and `reason` says why (Payments should then cancel / refund the payment).
   */
  async confirmAfterPayment(bookingId: string, paymentId: string) {
    const id = oid(bookingId, 'bookingId');

    const result = await this.connection.transaction(async (session: ClientSession) => {
      const booking = await this.bookingModel.findById(id).session(session).exec();
      if (!booking) throw new NotFoundException('Hotel booking not found');
      const no = (reason: string) => ({ confirmed: false, reason, fresh: false, booking });

      // webhook retry for a payment that already confirmed this booking
      if (booking.status === HotelBookingStatus.CONFIRMED && String(booking.paymentId) === paymentId) {
        return { confirmed: true, reason: undefined, fresh: false, booking };
      }
      if (booking.status !== HotelBookingStatus.PENDING_PAYMENT) return no(`INVALID_STATE_${booking.status}`);

      // The hold ran out: the booking becomes EXPIRED and the rooms stay released, even if payment succeeded late.
      if (!booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
        booking.status = HotelBookingStatus.EXPIRED;
        booking.expiredAt = new Date();
        await booking.save({ session });
        return no('HOLD_EXPIRED');
      }
      // PAY-02 is enforced by the Payments module when it creates the PaymentIntent;
      // the acceptance id lives on that Payment, not on the hotel booking.

      booking.status = HotelBookingStatus.CONFIRMED;
      booking.confirmedAt = new Date();
      booking.paymentId = oid(paymentId, 'paymentId');
      booking.holdExpiresAt = undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        booking.bookingReference = this.newReference();
        const clash = await this.bookingModel.exists({ bookingReference: booking.bookingReference }).session(session).exec();
        if (!clash) break;
      }
      await booking.save({ session });
      return { confirmed: true, reason: undefined, fresh: true, booking };
    });

    // The BOOKING_CONFIRMED notice is sent by the Stripe webhook (C2, PAY-01)
    // right after this returns, so it is not sent here as well.
    return { confirmed: result.confirmed, reason: result.reason, booking: result.booking };
  }

  private newReference() {
    return `HTL-${randomBytes(5).toString('hex').toUpperCase()}`;
  }

  // ---------------------------------------------------------------- hooks used by Payments (PAY-01 / PAY-02)

  /** Booking the user may pay for: own, PENDING_PAYMENT and hold not expired. */
  async getPayableBooking(bookingId: string, userId: string) {
    const booking = await this.bookingModel.findOne({ _id: oid(bookingId, 'bookingId'), userId: oid(userId) }).exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');
    if (booking.status !== HotelBookingStatus.PENDING_PAYMENT || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      throw new ConflictException('This reservation is no longer awaiting payment (hold expired or already processed)');
    }
    return booking;
  }

  async attachPolicyAcceptance(bookingId: string, userId: string, policyAcceptanceId: string) {
    const updated = await this.bookingModel.findOneAndUpdate(
      { _id: oid(bookingId, 'bookingId'), userId: oid(userId), status: HotelBookingStatus.PENDING_PAYMENT },
      { $set: { policyAcceptanceId: oid(policyAcceptanceId, 'policyAcceptanceId') } },
      { new: true },
    ).exec();
    if (!updated) throw new NotFoundException('Pending reservation not found');
    return updated;
  }

  // ---------------------------------------------------------------- expiry + completion (worker + lazy)

  /** Marks due holds EXPIRED (rooms are released implicitly: expired holds never block inventory). */
  async expireDueHolds(filter: QueryFilter<HotelBookingDocument> = {}): Promise<number> {
    const now = new Date();
    const due = await this.bookingModel
      .find({ ...filter, status: HotelBookingStatus.PENDING_PAYMENT, holdExpiresAt: { $lte: now } }, { _id: 1 })
      .lean().exec();
    let count = 0;
    for (const { _id } of due) {
      const res = await this.bookingModel.updateOne(
        { _id, status: HotelBookingStatus.PENDING_PAYMENT, holdExpiresAt: { $lte: now } }, // state guard: runs once
        { $set: { status: HotelBookingStatus.EXPIRED, expiredAt: now } },
      ).exec();
      // The open PaymentIntent of an expired hold is cancelled by C2's
      // PaymentExpiryService sweep (PAY-01), which sees the booking is no
      // longer payable.
      if (res.modifiedCount === 1) count++;
    }
    return count;
  }

  /** GEN-11: CONFIRMED -> COMPLETED once the check-out date has passed. */
  async completeDueBookings(filter: QueryFilter<HotelBookingDocument> = {}): Promise<number> {
    const res = await this.bookingModel.updateMany(
      { ...filter, status: HotelBookingStatus.CONFIRMED, checkOutDate: { $lt: todayUtc() } },
      { $set: { status: HotelBookingStatus.COMPLETED, completedAt: new Date() } },
    ).exec();
    return res.modifiedCount;
  }

  // ---------------------------------------------------------------- HTL-20: my reservations

  async listMine(user: AuthenticatedUser, q: ListBookingsQueryDto) {
    const userId = oid(user.userId);
    await this.expireDueHolds({ userId });
    await this.completeDueBookings({ userId });

    const now = new Date();
    const today = todayUtc();
    const filters: Record<BookingGroup, QueryFilter<HotelBookingDocument>> = {
      [BookingGroup.UPCOMING]: {
        $or: [
          { status: HotelBookingStatus.CONFIRMED, checkOutDate: { $gte: today } },
          { status: HotelBookingStatus.PENDING_PAYMENT, holdExpiresAt: { $gt: now } },
        ],
      },
      [BookingGroup.PAST]: {
        status: { $in: [HotelBookingStatus.COMPLETED, HotelBookingStatus.EXPIRED] },
      },
      [BookingGroup.CANCELLED]: { status: HotelBookingStatus.CANCELLED },
    };

    const [items, total, up, past, cancelled] = await Promise.all([
      this.bookingModel.find({ userId, ...filters[q.group] })
        .sort(q.group === BookingGroup.UPCOMING ? { checkInDate: 1 } : { checkInDate: -1 })
        .skip((q.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).exec(),
      this.bookingModel.countDocuments({ userId, ...filters[q.group] }).exec(),
      this.bookingModel.countDocuments({ userId, ...filters[BookingGroup.UPCOMING] }).exec(),
      this.bookingModel.countDocuments({ userId, ...filters[BookingGroup.PAST] }).exec(),
      this.bookingModel.countDocuments({ userId, ...filters[BookingGroup.CANCELLED] }).exec(),
    ]);

    const hotels = await this.hotels.briefs(items.map((b) => b.hotelId));
    return {
      group: q.group,
      counts: { upcoming: up, past, cancelled },
      ...new PageDto(items.map((b) => this.withHotel(b, hotels)), PageMetaDto.create(q.page, total)),
    };
  }

  /** Booking JSON (Decimal128 already converted to strings by the schema) plus the hotel's name/address. */
  private withHotel(b: HotelBookingDocument, hotels: Map<string, HotelBrief>) {
    const h = hotels.get(String(b.hotelId));
    return { ...b.toJSON(), hotel: h ? { id: h._id, name: h.name, address: h.address } : undefined };
  }

  /** Owner (or admin) can open full details. Anyone else gets 404 so private bookings are not revealed (ACC-10). */
  async findOneFor(user: AuthenticatedUser, id: string) {
    const bookingId = oid(id, 'id');
    await this.expireDueHolds({ _id: bookingId });
    await this.completeDueBookings({ _id: bookingId });
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');

    const isOwner = String(booking.userId) === user.userId;
    const isAdmin = user.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      if (user.role === Role.HOTEL_MODERATOR) await this.hotels.assertManagesHotel(user, String(booking.hotelId));
      else throw new NotFoundException('Hotel booking not found');
    }
    return this.withHotel(booking, await this.hotels.briefs([booking.hotelId]));
  }

  // ---------------------------------------------------------------- HTL-21: cancel

  private daysUntilCheckIn(checkIn: Date) {
    return Math.floor((checkIn.getTime() - todayUtc().getTime()) / DAY_MS);
  }

  private async getOwnConfirmed(user: AuthenticatedUser, id: string) {
    const booking = await this.bookingModel.findOne({ _id: oid(id, 'id'), userId: oid(user.userId) }).exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');
    if (booking.status !== HotelBookingStatus.CONFIRMED) throw new BadRequestException('Only CONFIRMED reservations can be cancelled');
    if (this.daysUntilCheckIn(booking.checkInDate) < 1) throw new BadRequestException('Cancellation is only possible before the check-in date');
    return booking;
  }

  /** Shown to the user before they confirm (HTL-21). Uses the policy snapshot taken at booking time. */
  async cancellationPreview(user: AuthenticatedUser, id: string) {
    const booking = await this.getOwnConfirmed(user, id);
    const days = this.daysUntilCheckIn(booking.checkInDate);
    const pct = pickRefundPercentage(booking.policySnapshot.cancellationTiers, days);
    return {
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      daysBeforeCheckIn: days,
      refundPercentage: pct,
      totalPrice: booking.totalPrice.toString(),
      refundAmount: centsToString(refundCents(toCents(booking.totalPrice), pct)),
      currency: booking.currency,
    };
  }

  /** Whole reservation only (no partial room cancellation). Rooms are released because inventory is derived from bookings. */
  async cancel(user: AuthenticatedUser, id: string, dto: CancelBookingDto) {
    const booking = await this.getOwnConfirmed(user, id);
    const days = this.daysUntilCheckIn(booking.checkInDate);
    const pct = pickRefundPercentage(booking.policySnapshot.cancellationTiers, days);
    const refund = refundCents(toCents(booking.totalPrice), pct);

    // atomic state transition CONFIRMED -> CANCELLED (guards against double cancel / races)
    const updated = await this.bookingModel.findOneAndUpdate(
      { _id: booking._id, userId: booking.userId, status: HotelBookingStatus.CONFIRMED },
      {
        $set: {
          status: HotelBookingStatus.CANCELLED,
          cancellation: {
            cancelledBy: new Types.ObjectId(user.userId),
            reason: dto.reason,
            refundPercentage: pct,
            refundAmount: centsToDecimal128(refund),
            cancelledAt: new Date(),
          },
        },
      },
      { new: true },
    ).exec();
    if (!updated) throw new ConflictException('Reservation was already cancelled or changed');

    if (refund > 0n) {
      try {
        const r = await this.payments?.requestRefund({
          bookingId: String(updated._id),
          paymentId: updated.paymentId ? String(updated.paymentId) : undefined,
          amount: centsToString(refund),
          refundPercentage: pct,
          reason: dto.reason ?? 'User cancellation',
          policySnapshot: updated.policySnapshot,
        });
        if (r?.refundId) {
          updated.cancellation!.refundId = oid(r.refundId, 'refundId');
          await updated.save();
        } else if (!this.payments) {
          this.logger.warn('HOTEL_PAYMENTS port not provided: refund amount recorded but no Stripe refund was created');
        }
      } catch (e) {
        this.logger.error(`Refund request failed for booking ${updated._id}: ${(e as Error).message}`);
      }
    }

    await this.safeNotify({
      userId: String(updated.userId),
      type: 'BOOKING_CANCELLED',
      title: 'Hotel reservation cancelled',
      message: `Reservation ${updated.bookingReference} was cancelled. Refund: ${centsToString(refund)} ${updated.currency} (${pct}%).`,
      resourceType: 'HOTEL_BOOKING',
      resourceId: String(updated._id),
    });
    return updated;
  }

  // ---------------------------------------------------------------- HTL-22: moderator dashboard

  async listForHotel(user: AuthenticatedUser, hotelId: string, q: ReservationsQueryDto) {
    const hotel = await this.hotels.assertManagesHotel(user, hotelId, true);
    await this.expireDueHolds({ hotelId: hotel._id });
    await this.completeDueBookings({ hotelId: hotel._id });

    const filter: QueryFilter<HotelBookingDocument> = { hotelId: hotel._id };
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      this.bookingModel.find(filter).sort({ checkInDate: -1 }).skip((q.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean().exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);
    const users = await this.userBriefs(items.map((b) => b.userId));
    return new PageDto(
      items.map((b) => {
        const u = users.get(String(b.userId));
        return {
          id: b._id,
          bookingReference: b.bookingReference ?? null,
          guest: { id: b.userId, name: u?.status === 'DEACTIVATED' ? 'Deleted user' : u?.name, email: u?.status === 'DEACTIVATED' ? undefined : u?.email },
          checkInDate: b.checkInDate,
          checkOutDate: b.checkOutDate,
          status: b.status,
          rooms: b.roomsSnapshot.map((r) => ({ roomId: r.roomId, roomNumber: r.roomNumberSnapshot, name: r.roomNameSnapshot })),
          adultCount: b.adultCount,
          childCount: b.childCount,
          totalPrice: b.totalPrice.toString(),
          currency: b.currency,
        };
      }),
      PageMetaDto.create(q.page, total),
    );
  }

  // ---------------------------------------------------------------- C2 payments port

  /** Raw booking for the payments port: payments checks ownership itself. */
  async findForPort(bookingId: string) {
    return this.bookingModel.findById(oid(bookingId, 'bookingId')).exec();
  }

  /** Idempotent PENDING_PAYMENT -> EXPIRED. Inventory is derived from booking status. */
  async releaseHoldForPort(bookingId: string): Promise<void> {
    // Called by Payments (C2) itself, which has already cancelled the
    // PaymentIntent, so there is nothing to call back.
    await this.bookingModel
      .updateOne(
        {
          _id: oid(bookingId, 'bookingId'),
          status: HotelBookingStatus.PENDING_PAYMENT,
        },
        {
          $set: {
            status: HotelBookingStatus.EXPIRED,
            expiredAt: new Date(),
            holdExpiresAt: undefined,
          },
        },
      )
      .exec();
  }

  /** ACC-12: a confirmed stay whose check-out has not passed yet. */
  async hasUpcomingConfirmedForPort(userId: string): Promise<boolean> {
    const count = await this.bookingModel
      .countDocuments({
        userId: oid(userId),
        status: HotelBookingStatus.CONFIRMED,
        checkOutDate: { $gte: todayUtc() },
      })
      .exec();
    return count > 0;
  }

  /** Guest names come from UsersService, never from the User model. */
  private async userBriefs(ids: Types.ObjectId[]) {
    const entries = await Promise.all(
      ids.map(async (id) => {
        const profile = await this.users.findById(String(id));
        return [String(id), profile] as const;
      }),
    );
    return new Map(entries);
  }

  private async safeNotify(input: Parameters<HotelNotificationsPort['notify']>[0]) {
    if (!this.notifications) return this.logger.warn(`HOTEL_NOTIFICATIONS port not provided; skipped ${input.type}`);
    try { await this.notifications.notify(input); }
    catch (e) { this.logger.error(`Notification failed: ${(e as Error).message}`); }
  }
}
