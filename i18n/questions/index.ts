import { Question } from '../../types';

export type Language = 'en' | 'el';

import { QUESTIONS_EL } from './el';
import { QUESTIONS_EN } from './en';

export const getQuestions = (lang: Language): Omit<Question, 'id'>[] => {
    switch (lang) {
        case 'el':
            return QUESTIONS_EL;
        case 'en':
        default:
            return QUESTIONS_EN;
    }
};

/** Stable ID derived from the fact text, so persisted used-question history survives. */
export const generateQuestionId = (fact: string): string => {
    let hash = 0;
    for (let i = 0; i < fact.length; i++) {
        const char = fact.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `q-${Math.abs(hash).toString(36)}`;
};

export const loadQuestions = (lang: Language): Question[] =>
    getQuestions(lang).map((question) => ({
        ...question,
        id: generateQuestionId(question.fact),
    }));
