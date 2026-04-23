import { useSession } from '~/auth/client'

export function useIsDemo(): boolean {
  const session = useSession()
  // better-auth useSession returns { data: { user, session } | null, ... }
  return Boolean((session.data?.user as { isDemo?: boolean } | undefined)?.isDemo)
}
