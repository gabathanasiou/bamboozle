import { I18N_EN } from './en';
import { I18N_EL } from './el';
import { Language } from './questions';

export type TranslationKey = keyof typeof I18N_EN;

export const getText = (lang: Language, key: TranslationKey, params: Record<string, any> = {}): string => {
    let template;

    if (lang === 'el') {
        // @ts-ignore
        template = I18N_EL[key];
    } else {
        template = I18N_EN[key];
    }

    // Fallback
    if (!template) {
        template = I18N_EN[key] || `[${key}]`;
    }

    return template.replace(/{(\w+)}/g, (_, k) => params[k] !== undefined ? params[k] : `unknown`);
};
