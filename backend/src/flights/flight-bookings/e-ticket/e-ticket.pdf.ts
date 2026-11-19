import PDFDocument from 'pdfkit';
import type { ETicketView } from './e-ticket.view';

// The built-in PDF fonts (Helvetica) only cover the Windows-1252 characters. Anything
// outside them, such as Arabic letters in a name, would print as garbage, so it becomes
// "?" instead. Passport names are written in Latin letters, so this is the rare case.
const PRINTABLE = /[^\x20-\x7E -ÿ–—‘’“”•]/g;

export function printable(text: string): string {
  return text.replace(PRINTABLE, '?');
}

const MARGIN = 50;
const MUTED = '#555555';
const RULE = '#BBBBBB';

/**
 * Draws the e-ticket (FLT-23) as an A4 PDF and resolves with its bytes. Plain text and
 * lines only, so it needs no font files or images.
 */
export function renderETicket(view: ETicketView): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `E-ticket ${view.bookingReference}`,
      Subject: 'Flight e-ticket',
      Author: 'Travel Planning & Booking Platform',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 2 * MARGIN;
  const text = (value: string, options?: PDFKit.Mixins.TextOptions) =>
    doc.text(printable(value), options);
  const heading = (value: string) => {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor('black');
    text(value);
    const y = doc.y + 2;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + width, y)
      .strokeColor(RULE)
      .stroke();
    doc.moveDown(0.4).font('Helvetica').fontSize(10);
  };
  const field = (label: string, value: string) => {
    doc.font('Helvetica-Bold').fillColor(MUTED);
    text(`${label}: `, { continued: true });
    doc.font('Helvetica').fillColor('black');
    text(value);
  };

  doc.font('Helvetica-Bold').fontSize(20);
  text('Flight e-ticket');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  text('Travel Planning & Booking Platform');
  doc.moveDown(0.8).fillColor('black').font('Helvetica-Bold').fontSize(14);
  text(`Booking reference: ${view.bookingReference}`);
  doc.font('Helvetica').fontSize(10);
  text(`${view.tripType}. Issued ${view.issuedOn}.`);

  heading(view.segments.length > 1 ? 'Flights' : 'Flight');
  view.segments.forEach((segment, index) => {
    if (index > 0) {
      doc.moveDown(0.6);
    }
    doc.font('Helvetica-Bold');
    text(`${segment.flightNumber}  ${segment.airlineName}`);
    doc.font('Helvetica');
    field('From', `${segment.from}, ${segment.departure}`);
    field('To', `${segment.to}, ${segment.arrival}`);
    field('Duration', segment.duration);
    field('Cabin', segment.cabin);
    field('Baggage', segment.baggage);
  });

  heading('Passengers');
  view.passengers.forEach((passenger, index) => {
    if (index > 0) {
      doc.moveDown(0.4);
    }
    doc.font('Helvetica-Bold');
    text(`${passenger.fullName} (${passenger.passengerType})`);
    doc.font('Helvetica');
    field('Document', passenger.documentNumber);
    field('Fare', passenger.fare);
    if (passenger.extraBags) {
      field('Extra baggage', passenger.extraBags);
    }
  });

  heading('Price');
  field('Fares', view.price.subtotal);
  field('Extra baggage', view.price.baggage);
  doc.font('Helvetica-Bold');
  text(`Total paid: ${view.price.total}`);
  doc.font('Helvetica');

  heading('Cancellation policy');
  view.cancellation.forEach((line) => text(line));

  doc.moveDown(1.2).fontSize(8).fillColor(MUTED);
  text(
    'Times are local to each airport. Bring the travel document whose number ends ' +
      'with the digits shown for each passenger.',
  );

  doc.end();
  return done;
}
