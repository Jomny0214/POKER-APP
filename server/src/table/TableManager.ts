import { VARIANTS } from "@poker/engine";
import { Table } from "./Table";
import { STAKES_LEVELS } from "./stakes";

export class TableManager {
  private tables = new Map<string, Table>();

  constructor() {
    // A fixed lobby: two stakes levels for every supported variant. Real
    // deployments would let players create/configure tables; this gives a
    // full, playable lobby out of the box.
    for (const variant of Object.values(VARIANTS)) {
      for (const stakes of [STAKES_LEVELS[0], STAKES_LEVELS[1]]) {
        const table = new Table(variant, stakes);
        this.tables.set(table.id, table);
      }
    }
  }

  list() {
    // Tournament tables are assigned automatically and aren't joinable from
    // the cash lobby, so they're excluded here even though they live in the
    // same registry (so the existing WS subscribe/action/draw messages work
    // against them unchanged).
    return [...this.tables.values()]
      .filter((t) => t.origin === "cash")
      .map((t) => t.getLobbyInfo());
  }

  get(id: string): Table | undefined {
    return this.tables.get(id);
  }

  /** Registers a tournament table so the existing WS handlers (subscribe,
   * sit/standup/action/draw dispatch on tableManager.get(tableId)) work
   * against it exactly like a cash table. */
  addTournamentTable(table: Table): void {
    this.tables.set(table.id, table);
  }

  removeTournamentTable(id: string): void {
    this.tables.delete(id);
  }
}

export const tableManager = new TableManager();
