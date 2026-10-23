import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

export const LabSection: React.FC<{
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}> = ({ title, subtitle, children, defaultOpen = true }) => (
    <details open={defaultOpen} className="group border-b border-white/10 bg-black/10">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 hover:bg-white/5">
            <div>
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-200">{title}</div>
                {subtitle && <div className="mt-0.5 text-[10px] text-slate-500">{subtitle}</div>}
            </div>
            <ChevronDown size={15} className="text-slate-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>
    </details>
);

export const LabField: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div className="block space-y-1.5">
        <span className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
            {hint && <span className="text-[9px] text-slate-600">{hint}</span>}
        </span>
        {children}
    </div>
);

export const LabSegmented = <T extends string>({
    value,
    options,
    onChange,
    disabled = false,
}: {
    value: T;
    options: Array<{ value: T; label: string; title?: string }>;
    onChange: (value: T) => void;
    disabled?: boolean;
}) => (
    <div className={`flex flex-wrap gap-1 rounded-lg border border-white/10 bg-black/20 p-1 ${disabled ? 'opacity-40' : ''}`}>
        {options.map((option) => (
            <button
                key={option.value}
                type="button"
                disabled={disabled}
                title={option.title ?? option.label}
                onClick={() => onChange(option.value)}
                className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                    value === option.value ? 'bg-yellow-400 text-black' : 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
                } disabled:cursor-not-allowed`}
            >
                {option.label}
            </button>
        ))}
    </div>
);

export const LabToggle: React.FC<{
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    hint?: string;
}> = ({ label, checked, onChange, hint }) => (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
        <span>
            <span className="block text-[11px] font-bold text-slate-300">{label}</span>
            {hint && <span className="block text-[9px] text-slate-600">{hint}</span>}
        </span>
        <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-yellow-400' : 'bg-slate-700'}`}>
            <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
    </label>
);

export const LabNumber: React.FC<{
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
}> = ({ label, value, onChange, min, max, step = 1 }) => (
    <LabField label={label}>
        <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-xs text-slate-200 outline-none focus:border-yellow-400/60"
        />
    </LabField>
);

export const LabText: React.FC<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    mono?: boolean;
}> = ({ label, value, onChange, placeholder, mono = false }) => (
    <LabField label={label}>
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={`w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-yellow-400/60 ${mono ? 'font-mono' : ''}`}
        />
    </LabField>
);

export const LabTextArea: React.FC<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    placeholder?: string;
    mono?: boolean;
}> = ({ label, value, onChange, rows = 3, placeholder, mono = false }) => (
    <LabField label={label}>
        <textarea
            value={value}
            rows={rows}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            className={`w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs leading-relaxed text-slate-200 outline-none placeholder:text-slate-700 focus:border-yellow-400/60 ${mono ? 'font-mono' : ''}`}
        />
    </LabField>
);

export const LabSelect: React.FC<{
    label: string;
    value: string;
    options?: Array<{ value: string; label: string }>;
    groups?: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
    onChange: (value: string) => void;
}> = ({ label, value, options = [], groups, onChange }) => {
    const id = useId();
    return (
        <LabField label={label}>
            <select
                id={id}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#111827] px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-yellow-400/60"
            >
                {groups
                    ? groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                            {group.options.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </optgroup>
                    ))
                    : options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
            </select>
        </LabField>
    );
};

export const LabButton: React.FC<{
    children: React.ReactNode;
    onClick: () => void;
    variant?: 'default' | 'primary' | 'ghost' | 'danger';
    title?: string;
    disabled?: boolean;
    fullWidth?: boolean;
}> = ({ children, onClick, variant = 'default', title, disabled = false, fullWidth = false }) => {
    const variants = {
        default: 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
        primary: 'border-yellow-300/40 bg-yellow-400 text-black hover:bg-yellow-300',
        ghost: 'border-transparent bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200',
        danger: 'border-red-400/20 bg-red-500/10 text-red-300 hover:bg-red-500/20',
    };
    return (
        <button
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-black uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${fullWidth ? 'w-full' : ''}`}
        >
            {children}
        </button>
    );
};

export const LabBadge: React.FC<{ children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }> = ({ children, tone = 'neutral' }) => {
    const tones = {
        neutral: 'border-white/10 bg-white/5 text-slate-400',
        good: 'border-green-400/20 bg-green-400/10 text-green-300',
        warn: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300',
        bad: 'border-red-400/20 bg-red-400/10 text-red-300',
    };
    return <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] ${tones[tone]}`}>{children}</span>;
};
