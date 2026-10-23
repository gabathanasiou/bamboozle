import type {
    DesignerConfig,
    DesignerDiagnostics,
    DesignerElementInfo,
    IssueKind,
    LayoutIssue,
} from './types';

const ROOT_ID = 'designer-preview-root';

const directText = (element: HTMLElement): string => {
    return Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
        .trim();
};

const escapeId = (value: string) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
};

export const cssSelector = (element: HTMLElement): string => {
    const root = document.getElementById(ROOT_ID);
    if (!root) return '';
    if (element === root) return `#${ROOT_ID}`;
    if (element.id) return `#${escapeId(element.id)}`;
    const testId = element.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    const region = element.getAttribute('data-region');
    if (region) return `[data-region="${region}"]`;

    const parts: string[] = [];
    let node: HTMLElement | null = element;
    while (node && node !== root && node.nodeType === Node.ELEMENT_NODE) {
        let part = node.tagName.toLowerCase();
        const parent: HTMLElement | null = node.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === node!.tagName);
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
    }
    return [`#${ROOT_ID}`, ...parts].join(' > ');
};

export const describeElement = (element: HTMLElement): DesignerElementInfo => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
        selector: cssSelector(element),
        tag: element.tagName.toLowerCase(),
        id: element.id,
        classes: typeof element.className === 'string' ? element.className : '',
        region: element.getAttribute('data-region') ?? element.getAttribute('data-testid') ?? '',
        text: (directText(element) || element.textContent?.trim() || '').replace(/\s+/g, ' ').slice(0, 160),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
        backgroundColor: style.backgroundColor,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
    };
};

const isScroller = (style: CSSStyleDeclaration, axis: 'x' | 'y') => {
    const value = axis === 'x' ? style.overflowX : style.overflowY;
    return value === 'auto' || value === 'scroll' || value === 'overlay';
};

const isLineClamped = (style: CSSStyleDeclaration) => {
    const clamp = style.getPropertyValue('-webkit-line-clamp');
    return !!clamp && clamp !== 'none';
};

const isIntentionalTruncation = (element: HTMLElement, style: CSSStyleDeclaration) => {
    return style.textOverflow === 'ellipsis' || element.classList.contains('truncate') || isLineClamped(style);
};

const hasScrollingAncestor = (element: HTMLElement, root: HTMLElement) => {
    let node: HTMLElement | null = element.parentElement;
    while (node && node !== root) {
        const style = window.getComputedStyle(node);
        if (isScroller(style, 'x') || isScroller(style, 'y')) return true;
        node = node.parentElement;
    }
    return false;
};

const hasClippingAncestor = (element: HTMLElement, root: HTMLElement) => {
    let node: HTMLElement | null = element.parentElement;
    while (node && node !== root) {
        const style = window.getComputedStyle(node);
        if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') return true;
        node = node.parentElement;
    }
    return false;
};

const labelFor = (element: HTMLElement, text: string) => {
    if (text) return text.slice(0, 64);
    const region = element.getAttribute('data-region') ?? element.getAttribute('data-testid');
    if (region) return `<${element.tagName.toLowerCase()} data-region="${region}">`;
    const className = typeof element.className === 'string'
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    return `<${element.tagName.toLowerCase()}${className ? `.${className}` : ''}>`;
};

export const scanLayout = (config: DesignerConfig): DesignerDiagnostics => {
    const root = document.getElementById(ROOT_ID);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const empty: DesignerDiagnostics = {
        issues: [],
        viewport,
        scroll: { width: 0, height: 0 },
        scannedAt: Date.now(),
    };
    if (!root) return empty;

    root.removeAttribute('data-designer-issue');
    root.querySelectorAll<HTMLElement>('[data-designer-issue]').forEach((element) => {
        element.removeAttribute('data-designer-issue');
    });

    const issues: LayoutIssue[] = [];
    const seen = new Set<string>();
    const addIssue = (
        kind: IssueKind,
        severity: LayoutIssue['severity'],
        element: HTMLElement,
        text: string,
        detail: string,
    ) => {
        const selector = cssSelector(element);
        const key = `${kind}:${selector}`;
        if (!selector || seen.has(key) || issues.length >= 40) return;
        seen.add(key);
        const rect = element.getBoundingClientRect();
        issues.push({
            id: `issue-${issues.length + 1}`,
            kind,
            severity,
            label: labelFor(element, text),
            selector,
            detail,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        });
        if (config.preview.showIssues) element.setAttribute('data-designer-issue', 'true');
    };

    const scrollWidth = Math.max(document.documentElement.scrollWidth, root.scrollWidth);
    const scrollHeight = Math.max(document.documentElement.scrollHeight, root.scrollHeight);
    if (scrollWidth > viewport.width + 1) {
        addIssue('page-overflow', 'error', root, 'Page overflows horizontally', `${scrollWidth}px > ${viewport.width}px`);
    }
    if (scrollHeight > viewport.height + 1) {
        addIssue('page-overflow', 'warning', root, 'Page overflows vertically', `${scrollHeight}px > ${viewport.height}px`);
    }

    const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
    for (const element of elements) {
        if (['SCRIPT', 'STYLE', 'LINK', 'META', 'SVG', 'PATH', 'G', 'DEFS', 'CLIPPATH', 'USE'].includes(element.tagName)) continue;
        if (element.closest('svg')) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
        const text = directText(element);

        if (text && !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
            const truncated = isIntentionalTruncation(element, style);
            const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
            const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
            if (!truncated && clipsX && element.scrollWidth > element.clientWidth + 4) {
                addIssue('clipped-text', 'error', element, text, `${element.scrollWidth}px wide in ${element.clientWidth}px`);
            }
            if (!truncated && clipsY && element.scrollHeight > element.clientHeight + 4) {
                addIssue('clipped-text', 'error', element, text, `${element.scrollHeight}px tall in ${element.clientHeight}px`);
            }
        }

        const isStatic = style.position === 'static' || style.position === 'relative';
        if (isStatic && !hasScrollingAncestor(element, root) && !hasClippingAncestor(element, root)) {
            const outside = rect.left < -2
                || rect.top < -2
                || rect.right > viewport.width + 2
                || rect.bottom > viewport.height + 2;
            if (outside) {
                addIssue(
                    'outside-viewport',
                    'warning',
                    element,
                    text,
                    `rect ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
                );
            }
        }
    }

    return {
        issues,
        viewport,
        scroll: { width: scrollWidth, height: scrollHeight },
        scannedAt: Date.now(),
    };
};

export const revealElement = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return false;
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    element.setAttribute('data-designer-flash', 'true');
    window.setTimeout(() => element.removeAttribute('data-designer-flash'), 1400);
    return true;
};
