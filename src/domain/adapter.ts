import type { CanonicalFill } from './fill'
import type { ImportSource, ValidationReport } from './import'

export type RawRow = {
  raw: Record<string, unknown>
  rowIndex: number
}

export interface SourceAdapter<TInput> {
  readonly source: ImportSource
  validate(input: TInput): Promise<ValidationReport>
  parse(input: TInput, importId: string): AsyncGenerator<RawRow>
  normalize(raw: RawRow): CanonicalFill | null
}
