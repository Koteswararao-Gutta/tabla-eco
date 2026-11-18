// Reads a photo of a paper catering order, or a pasted text message, with Claude and returns the order form's fields.
// Kept free of Firebase so it can be tested on its own.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// The cheapest Claude model. If it misreads messy handwriting often, try 'claude-sonnet-5-5'.
export const MODEL = 'claude-haiku-5-5';

/** Largest photo accepted, as base64 characters (about 3 MB of picture). */
export const MAX_IMAGE_CHARS = 4_000_000;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
/** Longest pasted message accepted, in characters. */
export const MAX_TEXT_CHARS = 8000;

export const ScannedOrder = z.object({
  isOrder: z.boolean().describe('false if the photo or message is not a food order at all'),
  customerName: z.string().describe("Customer's name, or empty"),
  phone: z.string().describe('Phone number as written, or empty'),
  date: z.string().describe('Due date as yyyy-mm-dd, or empty if no date is written'),
  time: z.string().describe('Due time as 24-hour HH:MM, or empty'),
  type: z.enum(['pickup', 'delivery', 'unknown']),
  address: z.string().describe('Delivery address, or empty'),
  people: z.string().describe('Number of people or guests as digits only, or empty'),
  items: z.array(z.string()).describe('One entry per ordered item, with its quantity or size, e.g. "Chicken biryani, 2 large trays"'),
  notes: z.string().describe('Anything else written that the kitchen should know, or empty'),
  unsure: z
    .array(z.enum(['customerName', 'phone', 'date', 'time', 'type', 'address', 'people', 'items', 'notes']))
    .describe('Fields that were hard to read or that you had to guess'),
});

const SYSTEM = `You read catering orders for Tabla, an Indian restaurant, and copy them into a form. An order is either a photo of a handwritten or printed paper, or a text message or email a customer sent, pasted as is.
Rules:
- Copy only what is written. Never invent a name, phone number, address or item. Leave a field empty when it is not in the order.
- A pasted message may hold a whole chat, greetings or signatures. Use only what describes the order; a name or phone number in a signature counts.
- Work out relative dates ("tomorrow", "Sat", "12/5") from today's date given below. Dates are US style (month/day).
- Times like "5", "5pm" or "17:00" become 24-hour HH:MM. A lunch or dinner time with no am/pm is pm unless it reads like a morning time.
- Keep dish names as written, fixing only obvious spelling slips. Put each item on its own entry with its quantity.
- Add a field to "unsure" whenever you had to guess or the writing is unclear.`;

/** Checks what the app sent. Returns an error message, or null when it is fine. */
export function checkRequest(data) {
  if (!data || typeof data !== 'object') return 'No photo was sent.';
  const { image, mediaType, text, today, weekday } = data;
  if (text !== undefined) {
    if (image !== undefined) return 'Send a photo or a message, not both.';
    if (typeof text !== 'string' || text.trim().length < 5) return 'The message is empty.';
    if (text.length > MAX_TEXT_CHARS) return 'That message is too long.';
  } else {
    if (typeof image !== 'string' || image.length < 100) return 'No photo was sent.';
    if (image.length > MAX_IMAGE_CHARS) return 'That photo is too large.';
    if (!MEDIA_TYPES.includes(mediaType)) return 'That file is not a photo.';
  }
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 'Missing today’s date.';
  if (typeof weekday !== 'string' || weekday.length > 12) return 'Missing today’s date.';
  return null;
}

/** The Messages API request for one photo or one pasted message. */
export function buildRequest({ image, mediaType, text, today, weekday }) {
  const content =
    typeof text === 'string'
      ? [{ type: 'text', text: `Today is ${weekday}, ${today}. Copy this catering order message into the form.\n\n<message>\n${text.trim()}\n</message>` }]
      : [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Today is ${weekday}, ${today}. Copy this catering order into the form.` },
        ];
  return {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(ScannedOrder) },
  };
}

/** Reads one photo or message. `client` is an Anthropic client. */
export async function readOrderPhoto(client, data) {
  const res = await client.messages.parse(buildRequest(data));
  if (!res.parsed_output) throw new Error(`No order in the reply (stop reason ${res.stop_reason})`);
  return res.parsed_output;
}
