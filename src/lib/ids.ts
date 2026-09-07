import { customAlphabet, nanoid } from "nanoid";

/**
 * Ids are generated on the client, before anything is saved. That is not an
 * optimisation: split.ts seeds its remainder rotation from the expense id, so
 * the id has to exist while the form is still previewing the shares. Otherwise
 * the split shown and the split saved could differ by a paisa.
 */
export const newId = (): string => nanoid(16);

/**
 * The slug is the group's URL, and the URL is the password — there are no
 * logins, and the server checks nothing but this string. So it has to be
 * unguessable, not merely unique.
 *
 * 12 characters of a 32-symbol alphabet is about 60 bits. Brute-forcing that
 * against a rate-limited HTTP endpoint is not a thing anyone will do.
 *
 * The alphabet drops the characters people confuse when reading a link aloud
 * or retyping one off a screen: 0/o, 1/l/i, u/v.
 */
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstwxyz";

export const newSlug = customAlphabet(SLUG_ALPHABET, 12);

/** Device keys never leave the device except to be written to a member row. */
export const newDeviceKey = (): string => nanoid(24);
