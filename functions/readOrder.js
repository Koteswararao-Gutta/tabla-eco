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

/** The units the order form offers. Keep in step with UNITS in src/manager/catering/lines.ts. */
export const UNITS = ['Full tray', 'Half tray', 'Pieces', 'Servings', 'Lbs', 'Quarts', 'Gallons', 'Plates'];
/** Most menu dish names sent along with an order (Tabla's menu has about 200). */
export const MAX_MENU_NAMES = 400;

export const ScannedOrder = z.object({
  isOrder: z.boolean().describe('false if the photo or message is not a food order at all'),
  customerName: z.string().describe("Customer's name, or empty"),
  phone: z.string().describe('Phone number as written, or empty'),
  date: z.string().describe('Due date as yyyy-mm-dd, or empty if no date is written'),
  time: z.string().describe('Due time as 24-hour HH:MM, or empty'),
  type: z.enum(['pickup', 'delivery', 'unknown']),
  address: z.string().describe('Delivery address, or empty'),
  people: z.string().describe('Number of people or guests as digits only, or empty'),
  lines: z
    .array(
      z.object({
        dish: z.string().describe('The dish: the exact name from the menu list when it clearly is that dish, otherwise as written'),
        qty: z.string().describe('How many, as digits (e.g. "2" or "1.5"), or empty'),
        unit: z.string().describe(`One of: ${UNITS.join(', ')}. FT means Full tray and HT means Half tray. Use another word only when none fits, or empty when no unit is written`),
        note: z.string().describe('Anything written about this one dish, like "extra spicy" or "no onion", or empty'),
        unsure: z.boolean().describe('true when this item was hard to read or you had to guess the dish, quantity or unit'),
      }),
    )
    .describe('One entry per ordered item'),
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
- Put each item on its own entry, split into dish, quantity, unit and note.
- When a menu list is given and an item clearly is one of those dishes, use the menu name exactly. Otherwise keep the dish name as written, fixing only obvious spelling slips, and mark the item unsure.
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

/** Dish names from the saved Toast menu (toastMenu/current), once each, for matching what is ordered. */
export function menuNames(menu) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(menu?.groups) ? menu.groups : []) {
    for (const i of Array.isArray(g?.items) ? g.items : []) {
      const name = typeof i?.name === 'string' ? i.name.trim().slice(0, 120) : '';
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out.slice(0, MAX_MENU_NAMES);
}

/** The Messages API request for one photo or one pasted message. `menu` is the list of dish names (may be empty). */
export function buildRequest({ image, mediaType, text, today, weekday }, menu = []) {
  const dishes = menu.length ? `\n\nDishes on our menu:\n<menu>\n${menu.join('\n')}\n</menu>` : '';
  const content =
    typeof text === 'string'
      ? [{ type: 'text', text: `Today is ${weekday}, ${today}. Copy this catering order message into the form.${dishes}\n\n<message>\n${text.trim()}\n</message>` }]
      : [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: `Today is ${weekday}, ${today}. Copy this catering order into the form.${dishes}` },
        ];
  return {
    model: MODEL,
    // Room for the model's thinking plus a long order, so it isn't cut off; low effort keeps it quick and cheap.
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: zodOutputFormat(ScannedOrder), effort: 'low' },
  };
}

/** Reads one photo or message. `client` is an Anthropic client; `menu` the dish names. */
export async function readOrderPhoto(client, data, menu = []) {
  const res = await client.messages.parse(buildRequest(data, menu));
  if (!res.parsed_output) {
    const e = new Error(`No order in the reply (stop reason ${res.stop_reason})`);
    e.unreadable = true;
    throw e;
  }
  return res.parsed_output;
}

/** What the manager sees when the photo or message can't be read (as opposed to the service being down). */
export const UNREADABLE = "Couldn't read this. Please try another photo or type the order in.";
export const UNREADABLE_TEXT = "Couldn't read this. Please check the message or type the order in.";

/** What a 400 from the API says when the problem is the photo or message itself (not our setup). */
const INPUT_PROBLEM = /image|media type|base64|too large|too long|exceed|refus/i;

/**
 * Sorts a failure:
 *  - 'unreadable': trying again with the same photo won't help (the image couldn't be processed or is too
 *    large, the model refused, or no form came back),
 *  - 'setup': any other 400 (a wrong model name or setting: our mistake, needs a fix in the code),
 *  - 'unavailable': network trouble, overload or server errors that may pass.
 */
export function readError(e) {
  if (e?.unreadable) return 'unreadable';
  const status = e?.status;
  const message = `${e?.message ?? ''} ${e?.error?.error?.message ?? ''}`;
  if (status === 413) return 'unreadable';
  if (status === 400) return INPUT_PROBLEM.test(message) ? 'unreadable' : 'setup';
  if (status === undefined && /Failed to parse structured output/.test(message)) return 'unreadable';
  return 'unavailable';
}
