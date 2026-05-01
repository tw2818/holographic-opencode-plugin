declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean; create?: boolean });
    prepare(sql: string): Statement;
    run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    query(sql: string): Statement;
    exec(sql: string): void;
    pragma(pragma: string): any;
    close(): void;
  }

  export class Statement {
    run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
    values(...params: any[]): any[];
    finalize(): void;
    toString(): string;
  }
}
