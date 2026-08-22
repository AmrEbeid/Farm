/** Convert reviewed Egyptian mobile forms to WhatsApp's E.164 digits-only format. */
export function whatsappDigits(phone: string | null): string | null {
  let digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^01\d{9}$/.test(digits)) digits = `20${digits.slice(1)}`;
  if (/^1\d{9}$/.test(digits)) digits = `20${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export function whatsappHref(phone: string | null, body: string): string | null {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}` : null;
}
