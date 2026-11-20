import PDFDocument from 'pdfkit';

const PRINTABLE = /[^\x20-\x7E -ÿ–—‘’“”•]/g;
const printable = (value: string) => value.replace(PRINTABLE, '?');

const MARGIN = 50;
const MUTED = '#555555';
const RULE = '#BBBBBB';

export interface ItineraryPdfView {
  title: string;
  startDate: string;
  countries: string[];
  days: {
    dayNumber: number;
    date: string;
    city: string;
    notes: string | null;
    activities: {
      name: string;
      time: string | null;
      cost: string | null;
      currency: string | null;
    }[];
  }[];
  cityGroups: {
    city: string;
    fromDay: number;
    toDay: number;
    dayCount: number;
  }[];
  transportCosts: {
    mode: string;
    fromCity: string;
    toCity: string;
    amount: string | null;
    currency: string;
  }[];
  summary: {
    currency: string;
    total: string;
    byCategory: Record<string, string>;
    rateDate: string;
    ratesStale: boolean;
  };
}

/** ITN-28: an A4 printout of one itinerary, built from plain text and rules. */
export function renderItineraryPdf(view: ItineraryPdfView): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `Itinerary ${view.title}`,
      Subject: 'Travel itinerary',
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
    doc
      .moveTo(MARGIN, doc.y + 2)
      .lineTo(MARGIN + width, doc.y + 2)
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
  text(view.title);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  text(`Starting ${view.startDate} · ${view.countries.join(', ')}`);
  if (view.summary.ratesStale) {
    doc.fillColor('#8a5a00').text('Exchange rates are cached (stale).');
  }
  doc.fillColor('black');

  heading('Days');
  view.days.forEach((day, index) => {
    if (index > 0) doc.moveDown(0.5);
    doc.font('Helvetica-Bold');
    text(`Day ${day.dayNumber} — ${day.date} — ${day.city}`);
    doc.font('Helvetica');
    if (day.notes) text(day.notes);
    day.activities.forEach((activity) => {
      doc.font('Helvetica-Bold');
      text(`  ${activity.time ? `${activity.time} ` : ''}${activity.name}`, {
        continued: true,
      });
      doc.font('Helvetica');
      text(`  (${activity.cost ?? '0.00'} ${activity.currency ?? ''})`);
    });
  });

  heading('City groups');
  view.cityGroups.forEach((group) =>
    field(
      group.city,
      `days ${group.fromDay}-${group.toDay} (${group.dayCount})`,
    ),
  );

  heading('Intercity transport');
  if (!view.transportCosts.length) text('None recorded.');
  view.transportCosts.forEach((cost) =>
    field(
      `${cost.fromCity} -> ${cost.toCity} (${cost.mode})`,
      `${cost.amount ?? '0.00'} ${cost.currency}`,
    ),
  );

  heading(`Budget (${view.summary.currency})`);
  Object.entries(view.summary.byCategory).forEach(([category, amount]) =>
    field(category.replaceAll('_', ' '), amount),
  );
  doc.moveDown(0.4).font('Helvetica-Bold');
  text(`Total: ${view.summary.total} ${view.summary.currency}`);
  doc.moveDown(0.6).font('Helvetica').fontSize(8).fillColor(MUTED);
  text(`Exchange rates as of ${view.summary.rateDate}.`);

  doc.end();
  return done;
}
