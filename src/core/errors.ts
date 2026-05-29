/** Base class for every error the import core raises. */
export class ImportError extends Error {}

/** A required sheet is absent from the workbook. */
export class SheetNotFoundError extends ImportError {
  constructor(public readonly sheet: string) {
    super(`sheet "${sheet}" not found in workbook`);
    this.name = 'SheetNotFoundError';
  }
}

/** A required column is absent from a sheet's header row. */
export class MissingColumnError extends ImportError {
  constructor(
    public readonly sheet: string,
    public readonly column: string,
  ) {
    super(`sheet "${sheet}" is missing required column "${column}"`);
    this.name = 'MissingColumnError';
  }
}

/** A port surface that is declared but not yet implemented (lands in #005). */
export class NotImplementedError extends ImportError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = 'NotImplementedError';
  }
}
