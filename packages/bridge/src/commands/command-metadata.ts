/**
 * Command Metadata — Natural Language Intent Matching
 *
 * Defines Turkish + English keyword patterns for each bridge-handled
 * slash command. Used by intent-adapter.ts to resolve user messages.
 */

export interface CommandMeta {
  /** Command name without leading slash (matches COMMAND_METADATA key) */
  name: string;
  /** Human-readable description */
  description: string;
  /**
   * Regex patterns to test against lowercased user input.
   * Any single match is sufficient to resolve the command.
   */
  patterns: RegExp[];
  /** Human-readable alias list (for display; not used in matching) */
  aliases: string[];
}

/** Flat entry for ordered iteration in COMMAND_INTENT_MAP */
export interface IntentEntry {
  pattern: RegExp;
  command: string; // format: "/commandName"
}

export const COMMAND_METADATA: Record<string, CommandMeta> = {
  cost: {
    name: 'cost',
    description: 'Show token usage and cost for the current session',
    patterns: [
      /ne kadar (harcad|masraf|tutt)/,
      /\b(harcama|masraf)\b/,
      /\bmaliyet\b(?! hesapla)/,
      /token (kullan|say|miktar)/,
      /\bspend|spent|spending\b/,
      /\bcost\b(?! of\b)/,
      /\bexpense\b/,
      /how much (did|does|will)/,
      /^how much$/,
      /token cost/,
      /(?<!context |api )\busage\b(?! stats| report| details| summary)/,
    ],
    aliases: [
      'ne kadar harcadım', 'maliyet', 'harcama', 'token kullanımı',
      'cost', 'spending', 'usage', 'how much',
    ],
  },

  status: {
    name: 'status',
    description: 'Show current session status and active sessions',
    patterns: [
      /oturum (durum|aktif|bilgi)/,
      /session (aktif|durum|var m)/,
      /durum (ne|nedir|goster)/,
      /^durum$/,
      /\baktif mi\b/,
      /\bstatus\b(?! code)/,
      /show (session|state|status)/,
      /is .*(running|active|alive)/,
      /session (state|info|list)/,
    ],
    aliases: [
      'durum', 'oturum durumu', 'aktif mi',
      'status', 'session state', 'is running',
    ],
  },

  help: {
    name: 'help',
    description: 'Show available bridge commands',
    patterns: [
      /yardı?m|yardim/,
      /komutlar? (neler|nedir|goster|listele)/,
      /^komutlar?$/,
      /ne yapabilir(sin|im)?/,
      /\bhelp\b(?! me\b)/,
      /show (help|commands)/,
      /what can (you|i)/,
      /available commands/,
      /komut listesi/,
    ],
    aliases: [
      'yardım', 'yardim et', 'komutlar',
      'help', 'show commands', 'what can you do',
    ],
  },

  clear: {
    name: 'clear',
    description: 'Clear current conversation and start fresh',
    patterns: [
      /sohbet[i]? (temizle|sifirla|bitir)/,
      /konusmay[i]? (temizle|sifirla)/,
      /\btemizle\b|\bsıfırla\b|\bsifirla\b/,
      /\bclear\b(?! (explanation|up|about|idea|picture|view|thinking|understanding))/,
      /new (session|conversation|chat)/,
      /start (fresh|over|new)/,
      /reset (chat|session|conversation)/,
    ],
    aliases: [
      'temizle', 'sıfırla', 'sohbeti temizle',
      'clear', 'new session', 'start fresh',
    ],
  },

  compact: {
    name: 'compact',
    description: 'Compact conversation context to save tokens',
    patterns: [
      /baglami? (sikistir|ozetle|compress)/,
      /bellegi? (ozetle|sikistir|temizle)/,
      /\bcompact\b/,
      /compress (memory|context)/,
      /summarize (context|memory)/,
      /context (compact|compress|shrink)/,
    ],
    aliases: [
      'bağlamı sıkıştır', 'belleği özetle', 'compact',
      'compress context', 'summarize memory',
    ],
  },

  doctor: {
    name: 'doctor',
    description: 'Run diagnostics and health check',
    patterns: [
      /\bdoktor\b/,
      /\bdoctor\b(?! strange| who| doom)/,
      /sorunlari? (kontrol|bul|duzelt)/,
      /saglik (kontrol|testi)/,
      /diagnos[e|is]/,
      /health[ -]?check/,
      /run (doctor|diagnostics|checks)/,
      /\bdiagnose\b/,
    ],
    aliases: [
      'doktor', 'sorunları kontrol et', 'sağlık kontrolü',
      'doctor', 'diagnose', 'health check', 'run checks',
    ],
  },

  model: {
    name: 'model',
    description: 'Change the AI model for the next message',
    patterns: [
      /model (degistir|switch|change|sec|degis)/,
      /\b(opus|sonnet|haiku)\b.*(kullan|sec|degistir|switch)/,
      /\buse (opus|sonnet|haiku)\b/,
      /switch to (opus|sonnet|haiku)/,
      /change (the )?model/,
      /daha (hizli|akilli).*(model|ai)/,
    ],
    aliases: [
      'model değiştir', 'opus kullan', 'sonnet kullan', 'haiku kullan',
      'use opus', 'switch to sonnet', 'change model',
    ],
  },

  rename: {
    name: 'rename',
    description: 'Rename the current session',
    patterns: [
      /session.*(adini?|isim).*(degistir|yenile|rename)/,
      /(adini?|isim).*(degistir|yenile).*session/,
      /yeniden adlandir/,
      /rename.*(session|oturum)/,
      /rename this (session|oturum)\b/,
      /change.*(session|oturum).*(name|ad|isim)/,
    ],
    aliases: [
      'session adını değiştir', 'yeniden adlandır',
      'rename session', 'change session name',
    ],
  },

  diff: {
    name: 'diff',
    description: 'Show recent file changes (git diff)',
    patterns: [
      /degisiklik(ler)?.*(ne|neler|goster|listele)/,
      /^degisiklikler$/,
      /ne (degisti|degismis)/,
      /son degisiklik/,
      /\bgit diff\b/,
      /show (changes|diff|modifications)/,
      /what (changed|was changed|did.*change)/,
      /recent (changes|modifications)/,
    ],
    aliases: [
      'değişiklikler', 'ne değişti', 'git diff',
      'show changes', 'what changed',
    ],
  },

  fast: {
    name: 'fast',
    description: 'Toggle fast mode on/off',
    patterns: [
      /hizli mod/,
      /\bfast mode\b/,
      /\b(ac|kapat|toggle|enable|disable|on|off)\b.*\b(fast|hizli)\b/,
      /\b(fast|hizli)\b.*\b(ac|kapat|toggle|enable|disable|on|off)\b/,
      /hizlandir/,
    ],
    aliases: [
      'hızlı mod', 'hızlı modu aç',
      'fast mode', 'toggle fast', 'enable fast mode',
    ],
  },

  effort: {
    name: 'effort',
    description: 'Set task effort level (low/medium/high)',
    patterns: [
      /efor.*(dusuk|orta|yuksek|low|medium|high)/,
      /(dusuk|orta|yuksek).*(efor|effort)/,
      /effort.*(low|medium|high|dusuk|orta|yuksek)/,
      /(low|medium|high).*(effort)/,
      /set effort/,
    ],
    aliases: [
      'efor yüksek', 'düşük efor', 'efor orta',
      'effort high', 'effort low', 'set effort',
    ],
  },

  resume: {
    name: 'resume',
    description: 'Resume a previous session',
    patterns: [
      /kaldigi yerden (devam|geri don)/,
      /onceki (oturum|session).*(devam|geri don|ac)/,
      /\bresume (session|oturum|a |the |previous)/,
      /continue (previous|last|where|from).*(session|left)/,
      /continue where i left/,
    ],
    aliases: [
      'kaldığı yerden devam', 'önceki oturuma devam',
      'resume session', 'continue previous session',
    ],
  },

  context: {
    name: 'context',
    description: 'Show current context window usage',
    patterns: [
      /baglam.*(dolu|kullanim|kac|ne kadar)/,
      /context.*(dolu|doluluk|window|size|usage|kac)/,
      /kac token (kaldi|kullandim|var)/,
      /how (much|many).*(context|token).*(left|remain|used|have)/,
      /context (full|overflow|percentage|usage|remaining|left)/,
      /how (full|much) (is )?context/,
    ],
    aliases: [
      'bağlam ne kadar dolu', 'kaç token kaldı',
      'context usage', 'context window size', 'how much context is left',
    ],
  },

  usage: {
    name: 'usage',
    description: 'Show detailed API usage statistics',
    patterns: [
      /api (kullanim|usage|istatistik|stats)/,
      /kullanim (raporu?|istatistik|detay|ozet)/,
      /\busage (stats|report|details|summary)\b/,
      /api (stats|summary|report)/,
    ],
    aliases: [
      'api kullanım istatistikleri', 'kullanım raporu',
      'usage stats', 'api usage report',
    ],
  },
};

/**
 * Flat ordered array for linear iteration in resolveIntent.
 * Built once at module load time from COMMAND_METADATA.
 */
export const COMMAND_INTENT_MAP: ReadonlyArray<IntentEntry> = Object.entries(
  COMMAND_METADATA,
).flatMap(([name, meta]) =>
  meta.patterns.map((pattern) => ({ pattern, command: `/${name}` })),
);
