/** A business-rule refusal with a stable code. Controllers map it to a 400 with a safe message. */
export class RuleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RuleError';
  }
}
