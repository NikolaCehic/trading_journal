export class DemoReadonlyError extends Error {
  readonly code = 'demo_mode_readonly'
  constructor() {
    super('Writes are disabled in demo mode. Sign in with your own account to save changes.')
    this.name = 'DemoReadonlyError'
  }
}

export function assertNotDemo(user: { isDemo?: boolean | null } | undefined | null): void {
  if (user?.isDemo) throw new DemoReadonlyError()
}
