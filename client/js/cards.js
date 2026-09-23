const SUIT_SYMBOL = { c: "♣", d: "♦", h: "♥", s: "♠" };

export function cardEl(code, extraClass = "") {
  const div = document.createElement("div");
  if (code === "??" || !code) {
    div.className = `card back ${extraClass}`;
    div.innerHTML = `<div class="card-back-pattern"></div>`;
    return div;
  }
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  const isRed = suit === "h" || suit === "d";
  const symbol = SUIT_SYMBOL[suit] ?? suit;
  div.className = `card ${isRed ? "red" : "black"} ${extraClass}`;
  div.innerHTML = `
    <div class="card-corner card-corner-top"><span class="card-rank">${rank}</span><span class="card-suit">${symbol}</span></div>
    <div class="card-pip">${symbol}</div>
    <div class="card-corner card-corner-bottom"><span class="card-rank">${rank}</span><span class="card-suit">${symbol}</span></div>
  `;
  return div;
}

export function renderCardRow(container, codes, extraClass = "") {
  container.innerHTML = "";
  for (const c of codes) container.appendChild(cardEl(c, extraClass));
}
