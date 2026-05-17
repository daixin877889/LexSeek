export const adminBrandFocusClass = 'brand-control-focus'

export const adminBrandPrimaryButtonClass =
    'bg-gradient-brand-button text-white brand-control-focus hover:brightness-105'

export const adminBrandSwitchClass =
    'brand-control-focus data-[state=checked]:bg-gradient-brand-button'

export const adminBrandCheckboxClass =
    'brand-control-focus data-[state=checked]:border-transparent data-[state=checked]:bg-gradient-brand-button data-[state=checked]:text-white'

export const adminBrandChipClass =
    'border-primary/20 bg-primary/10 text-primary hover:bg-primary/15'

export const adminBrandSelectedBoxClass =
    'border-transparent bg-gradient-brand-button text-white'

export const adminBrandUnselectedBoxClass = 'border-input'

export const adminBrandSelectedListItemClass =
    'border-l-primary bg-primary/5 hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15'

export const adminBrandUnselectedListItemClass =
    'border-l-transparent hover:bg-muted/30'

export const adminBrandListItemFocusClass =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-inset'

export const adminBrandEnabledBadgeClass =
    'border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'

export const adminBrandDisabledBadgeClass =
    'border-transparent bg-muted text-muted-foreground'

export const adminBrandActiveBadgeClass =
    'border-transparent bg-primary/10 text-primary'

export const adminBrandDestructiveActionClass =
    'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40'

export const adminBrandWarningBadgeClass =
    'border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300'

export const adminBrandErrorBadgeClass =
    'border-transparent bg-destructive/10 text-destructive'

const NODE_TYPE_TONES: Record<string, { background: string; borderColor: string; color: string }> = {
    analysis: {
        background: 'linear-gradient(135deg, #D7EEFF, #B8DCF9)',
        borderColor: '#8FC6F5',
        color: '#075985',
    },
    document: {
        background: 'linear-gradient(135deg, #D7F8EF, #AEEBD8)',
        borderColor: '#74DCC2',
        color: '#047857',
    },
    extraction: {
        background: 'linear-gradient(135deg, #FFE4B8, #FFC675)',
        borderColor: '#F59E0B',
        color: '#92400E',
    },
    agent: {
        background: 'linear-gradient(135deg, #E4E0FF, #C8C1F4)',
        borderColor: '#9A8FE2',
        color: '#312E81',
    },
}

const PROMPT_TYPE_TONES: Record<string, { background: string; borderColor: string; color: string }> = {
    system: {
        background: 'linear-gradient(135deg, #D7EEFF, #B8DCF9)',
        borderColor: '#8FC6F5',
        color: '#075985',
    },
    user: {
        background: 'linear-gradient(135deg, #D7F8EF, #AEEBD8)',
        borderColor: '#74DCC2',
        color: '#047857',
    },
    user_injection: {
        background: 'linear-gradient(135deg, #FFE4B8, #FFC675)',
        borderColor: '#F59E0B',
        color: '#92400E',
    },
    assistant: {
        background: 'linear-gradient(135deg, #E4E0FF, #C8C1F4)',
        borderColor: '#9A8FE2',
        color: '#312E81',
    },
}

const getToneStyle = (
    tones: Record<string, { background: string; borderColor: string; color: string }>,
    value: string,
    fallback: string,
): Record<string, string> => {
    const tone = tones[value] ?? tones[fallback]!

    return {
        background: tone.background,
        borderColor: tone.borderColor,
        color: tone.color,
    }
}

export const getAdminNodeTypeBadgeStyle = (type: string): Record<string, string> =>
    getToneStyle(NODE_TYPE_TONES, type, 'analysis')

export const getAdminPromptTypeBadgeStyle = (type: string): Record<string, string> =>
    getToneStyle(PROMPT_TYPE_TONES, type, 'system')

export const getAdminStatusBadgeClass = (active: boolean) =>
    active ? adminBrandEnabledBadgeClass : adminBrandDisabledBadgeClass

export const getAdminThinkingBadgeClass = (active: boolean) =>
    active ? adminBrandActiveBadgeClass : adminBrandDisabledBadgeClass

export const getAdminProductTypeBadgeClass = (type: number | string) =>
    Number(type) === 1 ? adminBrandActiveBadgeClass : adminBrandWarningBadgeClass

export const getAdminCampaignTypeBadgeClass = (type: number | string): string => {
    if (Number(type) === 1) return adminBrandActiveBadgeClass
    if (Number(type) === 2) return adminBrandEnabledBadgeClass
    if (Number(type) === 3) return adminBrandWarningBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminRedemptionTypeBadgeClass = (type: number | string): string => {
    if (Number(type) === 1) return adminBrandActiveBadgeClass
    if (Number(type) === 2) return adminBrandWarningBadgeClass
    if (Number(type) === 3) return adminBrandEnabledBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminRedemptionStatusBadgeClass = (status: number | string): string => {
    if (Number(status) === 1) return adminBrandEnabledBadgeClass
    if (Number(status) === 2) return adminBrandActiveBadgeClass
    if (Number(status) === 3) return adminBrandDisabledBadgeClass
    if (Number(status) === 4) return adminBrandErrorBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminHttpMethodBadgeClass = (method: string): string => {
    if (method === 'GET') return adminBrandActiveBadgeClass
    if (method === 'POST') return adminBrandEnabledBadgeClass
    if (method === 'DELETE') return adminBrandErrorBadgeClass
    if (method === 'PUT' || method === 'PATCH') return adminBrandWarningBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminLegalTypeBadgeClass = (type: string): string => {
    if (type === 'law') return adminBrandActiveBadgeClass
    if (type === 'regulation') return adminBrandEnabledBadgeClass
    if (type === 'judicial_interp') return adminBrandWarningBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminLegalArticleTypeBadgeClass = (type: string): string => {
    if (type === 'l5') return adminBrandActiveBadgeClass
    if (type === 'l4') return adminBrandWarningBadgeClass
    if (type === 'l3') return adminBrandEnabledBadgeClass
    if (type === 'l2') return 'border-transparent bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
    if (type === 'l1') return 'border-transparent bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
    return adminBrandDisabledBadgeClass
}

export const getAdminLegalStatusBadgeClass = (status: string): string => {
    if (status === '有效') return adminBrandEnabledBadgeClass
    if (status === '已失效') return adminBrandErrorBadgeClass
    return adminBrandWarningBadgeClass
}

export const getAdminModelTypeBadgeClass = (type: string): string => {
    if (type === 'chat') return adminBrandActiveBadgeClass
    if (type === 'embedding') return adminBrandEnabledBadgeClass
    if (type === 'asr') return adminBrandWarningBadgeClass
    if (type === 'rerank') return 'border-transparent bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
    return adminBrandDisabledBadgeClass
}

export const getAdminPointItemGroupBadgeClass = (group: string): string => {
    if (group === 'material') return adminBrandActiveBadgeClass
    if (group === 'analysisModules') return adminBrandEnabledBadgeClass
    if (group === 'agentToken') return adminBrandWarningBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminTaskStatusBadgeClass = (status: number | string): string => {
    if (Number(status) === 0) return adminBrandDisabledBadgeClass
    if (Number(status) === 1) return adminBrandWarningBadgeClass
    if (Number(status) === 2) return adminBrandEnabledBadgeClass
    if (Number(status) === 3) return adminBrandErrorBadgeClass
    return adminBrandDisabledBadgeClass
}

export const getAdminContractReviewStatusBadgeClass = (status: string): string => {
    if (status === 'completed') return adminBrandEnabledBadgeClass
    if (status === 'failed') return adminBrandErrorBadgeClass
    if (status === 'reviewing' || status === 'awaiting_stance' || status === 'rebuilding') {
        return adminBrandWarningBadgeClass
    }
    return adminBrandDisabledBadgeClass
}

export const getAdminRiskLevelBadgeClass = (level: string): string => {
    if (level === 'high') return adminBrandErrorBadgeClass
    if (level === 'medium') return adminBrandWarningBadgeClass
    if (level === 'low') return adminBrandEnabledBadgeClass
    return adminBrandDisabledBadgeClass
}
