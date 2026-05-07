export type CustomizationKind = 'agent' | 'prompt' | 'instruction' | 'skill' | 'hook';
export type MarkdownCustomizationKind = Exclude<CustomizationKind, 'hook'>;
export type InstructionCustomizationType = 'scoped' | 'copilot' | 'agents' | 'claude';
