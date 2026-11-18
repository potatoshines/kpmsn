// Rendering of one catalog row for the representative's suggestion card.
// Order: description, eligibility, region, then the program link last. Optional fields (description,
// eligibility, region) are left out when empty, so there is never a label with nothing after it. A missing name or link is NOT left out: the card says it is not
// available and is flagged, and it cannot be added to a follow-up until the catalog row is fixed.

export const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// For values placed inside an HTML attribute (href, data-*): also escape quotes.
export const escAttr = (s) => esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const nameOf = (r) => r.name || `Name not available (${r.id})`;
export const isFlagged = (r) => r.issues.some((i) => i === "name_missing" || i.startsWith("link_"));

export function cardParts(r) {
  const flagged = isFlagged(r),
    parts = [];
  const title = r.name
    ? `<b>${esc(r.name)}</b>`
    : `<b class="flag">⚠ Resource name not available</b>`;
  if (r.description) parts.push(`<p><b>Description:</b> ${esc(r.description)}</p>`);
  if (r.eligibility) parts.push(`<p class="mut"><b>Eligibility:</b> ${esc(r.eligibility)}</p>`);
  if (r.region) parts.push(`<p class="mut"><b>Region:</b> ${esc(r.region)}</p>`);
  // The link is always the last item on the card.
  parts.push(
    r.url
      ? `<p class="lnk"><a href="${escAttr(r.url)}" target="_blank" rel="noopener">Open program link <span aria-hidden="true">↗</span></a></p>`
      : `<p class="flag">⚠ Link not available${r.issues.includes("link_invalid") ? " (the catalog link is not a valid web address)" : ""}</p>`,
  );
  if (flagged)
    parts.push(
      `<p class="mut">Catalog ID ${esc(r.id)}. This cannot be added to a follow-up until the catalog row is fixed.</p>`,
    );
  return { title, body: parts.join(""), flagged };
}
