const SUIT_SYMBOL = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function cardEl(code, extraClass = "") {
  const div = document.createElement("div");
  if (code === "??" || !code) {
    div.className = `card back ${extraClass}`;
    return div;
  }
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  const isRed = suit === "h" || suit === "d";
  div.className = `card ${isRed ? "red" : "black"} ${extraClass}`;
  div.textContent = `${rank}${SUIT_SYMBOL[suit] ?? suit}`;
  return div;
}

export function renderCardRow(container, codes, extraClass = "") {
  container.innerHTML = "";
  for (const c of codes) container.appendChild(cardEl(c, extraClass));
}
