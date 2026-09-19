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
    return [...this.tables.values()].map((t) => t.getLobbyInfo());
  }

  get(id: string): Table | undefined {
    return this.tables.get(id);
  }
}

export const tableManager = new TableManager();
