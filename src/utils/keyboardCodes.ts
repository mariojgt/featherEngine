export interface KeyCodeOption {
  code: string;
  label: string;
  group: string;
}

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({
  code: `Key${letter}`,
  label: letter,
  group: 'Letters',
}));

const digits = Array.from({ length: 10 }, (_, value) => ({
  code: `Digit${value}`,
  label: `${value}`,
  group: 'Numbers',
}));

const functions = Array.from({ length: 24 }, (_, index) => ({
  code: `F${index + 1}`,
  label: `F${index + 1}`,
  group: 'Function Keys',
}));

const numpad = [
  ...Array.from({ length: 10 }, (_, value) => ({ code: `Numpad${value}`, label: `Numpad ${value}`, group: 'Numpad' })),
  { code: 'NumpadAdd', label: 'Numpad +', group: 'Numpad' },
  { code: 'NumpadSubtract', label: 'Numpad -', group: 'Numpad' },
  { code: 'NumpadMultiply', label: 'Numpad *', group: 'Numpad' },
  { code: 'NumpadDivide', label: 'Numpad /', group: 'Numpad' },
  { code: 'NumpadDecimal', label: 'Numpad .', group: 'Numpad' },
  { code: 'NumpadEnter', label: 'Numpad Enter', group: 'Numpad' },
  { code: 'NumpadEqual', label: 'Numpad =', group: 'Numpad' },
];

export const KEY_CODE_OPTIONS = [
  { code: 'Space', label: 'Space', group: 'Common' },
  { code: 'Enter', label: 'Enter', group: 'Common' },
  { code: 'Escape', label: 'Escape', group: 'Common' },
  { code: 'Tab', label: 'Tab', group: 'Common' },
  { code: 'Backspace', label: 'Backspace', group: 'Common' },
  { code: 'Delete', label: 'Delete', group: 'Common' },
  { code: 'ShiftLeft', label: 'Left Shift', group: 'Modifiers' },
  { code: 'ShiftRight', label: 'Right Shift', group: 'Modifiers' },
  { code: 'ControlLeft', label: 'Left Ctrl', group: 'Modifiers' },
  { code: 'ControlRight', label: 'Right Ctrl', group: 'Modifiers' },
  { code: 'AltLeft', label: 'Left Alt', group: 'Modifiers' },
  { code: 'AltRight', label: 'Right Alt', group: 'Modifiers' },
  { code: 'MetaLeft', label: 'Left Meta', group: 'Modifiers' },
  { code: 'MetaRight', label: 'Right Meta', group: 'Modifiers' },
  { code: 'CapsLock', label: 'Caps Lock', group: 'Modifiers' },
  { code: 'ArrowUp', label: 'Arrow Up', group: 'Navigation' },
  { code: 'ArrowDown', label: 'Arrow Down', group: 'Navigation' },
  { code: 'ArrowLeft', label: 'Arrow Left', group: 'Navigation' },
  { code: 'ArrowRight', label: 'Arrow Right', group: 'Navigation' },
  { code: 'Home', label: 'Home', group: 'Navigation' },
  { code: 'End', label: 'End', group: 'Navigation' },
  { code: 'PageUp', label: 'Page Up', group: 'Navigation' },
  { code: 'PageDown', label: 'Page Down', group: 'Navigation' },
  ...letters,
  ...digits,
  ...functions,
  ...numpad,
  { code: 'Minus', label: '- / _', group: 'Punctuation' },
  { code: 'Equal', label: '= / +', group: 'Punctuation' },
  { code: 'BracketLeft', label: '[ / {', group: 'Punctuation' },
  { code: 'BracketRight', label: '] / }', group: 'Punctuation' },
  { code: 'Backslash', label: '\\ / |', group: 'Punctuation' },
  { code: 'Semicolon', label: '; / :', group: 'Punctuation' },
  { code: 'Quote', label: "' / quote", group: 'Punctuation' },
  { code: 'Backquote', label: '` / ~', group: 'Punctuation' },
  { code: 'Comma', label: ', / <', group: 'Punctuation' },
  { code: 'Period', label: '. / >', group: 'Punctuation' },
  { code: 'Slash', label: '/ / ?', group: 'Punctuation' },
  { code: 'Mouse0', label: 'Left Mouse', group: 'Mouse' },
  { code: 'Mouse1', label: 'Middle Mouse', group: 'Mouse' },
  { code: 'Mouse2', label: 'Right Mouse', group: 'Mouse' },
  { code: 'Mouse3', label: 'Mouse Back', group: 'Mouse' },
  { code: 'Mouse4', label: 'Mouse Forward', group: 'Mouse' },
] as const satisfies readonly KeyCodeOption[];

export const keyLabelByCode = (code: string | undefined): string => {
  if (!code) return 'W';
  const known = KEY_CODE_OPTIONS.find((option) => option.code === code);
  if (known) return known.label;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) return ['Left Mouse', 'Middle Mouse', 'Right Mouse'][Number(code.slice(5))] ?? code;
  return code;
};