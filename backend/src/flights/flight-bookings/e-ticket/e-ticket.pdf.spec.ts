import { printable, renderETicket } from './e-ticket.pdf';
import type { ETicketView } from './e-ticket.view';

const VIEW: ETicketView = {
  bookingReference: 'K7Q2PX',
  issuedOn: '18 Nov 2026, 21:05 (UTC+00:00)',
  tripType: 'Round trip',
  segments: [
    {
      flightNumber: 'KD100',
      airlineName: 'KE Demo Air',
      from: 'Cairo International Airport (CAI)',
      to: 'Dubai International Airport (DXB)',
      departure: '20 Dec 2026, 08:30 (UTC+02:00)',
      arrival: '20 Dec 2026, 14:30 (UTC+04:00)',
      duration: '4h 00m',
      cabin: 'ECONOMY',
      baggage: '1 bag included, up to 23 kg each',
    },
    {
      flightNumber: 'KD101',
      airlineName: 'KE Demo Air',
      from: 'Dubai International Airport (DXB)',
      to: 'Cairo International Airport (CAI)',
      departure: '27 Dec 2026, 16:00 (UTC+04:00)',
      arrival: '27 Dec 2026, 18:00 (UTC+02:00)',
      duration: '4h 00m',
      cabin: 'ECONOMY',
      baggage: '1 bag included, up to 20 kg each',
    },
  ],
  passengers: [
    {
      fullName: 'Khaled Elshitany',
      passengerType: 'ADULT',
      documentNumber: '•••••5678',
      fare: '409.99 USD',
      extraBags: '1 extra bag, up to 20 kg each (30.00 USD)',
    },
  ],
  price: { subtotal: '409.99 USD', baggage: '30.00 USD', total: '439.99 USD' },
  cancellation: ['7 days or more before departure: 80% refund'],
};

describe('printable', () => {
  it('keeps Latin text, accents and the bullet that masks document numbers', () => {
    expect(printable('José Müller •••••5678 – 20 Dec')).toBe(
      'José Müller •••••5678 – 20 Dec',
    );
  });

  it('replaces characters the built-in PDF fonts cannot draw', () => {
    expect(printable('خالد Khaled')).toBe('???? Khaled');
    expect(printable('CAI → DXB')).toBe('CAI ? DXB');
  });
});

describe('renderETicket (FLT-23)', () => {
  it('produces a complete PDF document', async () => {
    const pdf = await renderETicket(VIEW);
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    // pdfkit stores the title as its own object: "n 0 obj (E-ticket K7Q2PX) endobj".
    expect(raw).toContain('(E-ticket K7Q2PX)');
  });

  it('fits a round trip on one page', async () => {
    const raw = (await renderETicket(VIEW)).toString('latin1');

    expect(raw.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('does not fail on a name the fonts cannot draw', async () => {
    const view: ETicketView = {
      ...VIEW,
      passengers: [{ ...VIEW.passengers[0], fullName: 'خالد الشيطاني' }],
    };

    await expect(renderETicket(view)).resolves.toBeInstanceOf(Buffer);
  });
});
