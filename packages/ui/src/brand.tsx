export function Brand({compact = false}: {compact?: boolean}) {
  return <img src={compact ? '/brand/vodown-symbol.png' : '/brand/vodown-logo.png'} alt="Vodown" width={compact ? 40 : 180} height={compact ? 48 : 60} className={compact ? 'h-10 w-9 object-contain' : 'h-12 w-44 object-contain'}/>;
}
