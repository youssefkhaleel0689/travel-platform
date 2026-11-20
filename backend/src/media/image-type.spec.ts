import { detectImageType } from './image-type';

describe('detectImageType (GEN-08)', () => {
  it('recognises a PNG by its 8-byte signature', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
    ]);
    expect(detectImageType(png)).toBe('image/png');
  });

  it('recognises a JPEG by its 3-byte signature', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(detectImageType(jpeg)).toBe('image/jpeg');
  });

  it.each([
    ['a GIF', Buffer.from('GIF89a', 'ascii')],
    ['a script renamed to .png', Buffer.from('<script>alert(1)</script>')],
    ['a truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e])],
    ['an empty file', Buffer.alloc(0)],
  ])('refuses %s', (_label, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });
});
