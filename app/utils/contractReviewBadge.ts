import type { BadgeVariants } from '~/components/ui/badge'

type Variant = NonNullable<BadgeVariants['variant']>

export function getReviewStatusBadgeVariant(status: string): Variant {
    if (status === 'completed') return 'default'
    if (status === 'failed') return 'destructive'
    if (status === 'reviewing' || status === 'awaiting_stance') return 'secondary'
    return 'outline'
}

export function getRiskLevelBadgeVariant(level: string): Variant {
    if (level === 'high') return 'destructive'
    if (level === 'medium') return 'default'
    return 'secondary'
}
