import { Types } from 'mongoose';
import { buildCloneData } from './itinerary-clone.logic';
import {
  BudgetCategory,
  Itinerary,
  TransportMode,
  Visibility,
} from './schemas/itinerary.schema';

const oid = () => new Types.ObjectId();

function source(): Itinerary {
  const dayId = oid();
  return {
    _id: oid(),
    owner: oid(),
    title: 'Trip',
    countries: ['FR'],
    startDate: new Date('2026-12-20'),
    visibility: Visibility.PUBLIC,
    days: [
      {
        _id: dayId,
        city: 'paris',
        notes: 'n',
        activities: [
          { _id: oid(), name: 'A', cost: 5, currency: 'EUR' },
        ] as Itinerary['days'][number]['activities'],
        budgetEntries: [
          {
            _id: oid(),
            category: BudgetCategory.FOOD,
            amount: 9,
            currency: 'EUR',
          },
        ],
      },
    ],
    transportCosts: [
      {
        _id: oid(),
        mode: TransportMode.TRAIN,
        fromCity: 'london',
        toCity: 'paris',
        amount: 80,
        currency: 'GBP',
        dayId,
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('buildCloneData', () => {
  it('makes a private copy owned by the cloner, with attribution', () => {
    const src = source();
    const me = oid();
    const copy = buildCloneData(src, me);
    expect(copy.owner).toBe(me);
    expect(copy.visibility).toBe(Visibility.PRIVATE);
    expect(copy.clonedFrom).toEqual({
      itineraryId: src._id,
      authorId: src.owner,
    });
    expect(copy.title).toBe('Trip');
  });

  it('gives the copy new day ids and re-points transport costs to them', () => {
    const src = source();
    const copy = buildCloneData(src, oid());
    expect(copy.days[0]._id.equals(src.days[0]._id)).toBe(false);
    expect(copy.transportCosts[0].dayId.equals(copy.days[0]._id)).toBe(true);
    expect(copy.days[0].activities[0]).not.toHaveProperty('_id');
    expect(copy.days[0].budgetEntries[0]).toMatchObject({ amount: 9 });
  });

  it('does not share arrays with the original', () => {
    const src = source();
    const copy = buildCloneData(src, oid());
    copy.countries.push('GB');
    expect(src.countries).toEqual(['FR']);
  });
});
