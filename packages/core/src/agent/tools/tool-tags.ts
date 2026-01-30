/**
 * Search Tags Registry for Tool Discovery
 *
 * These tags enable the search_tools meta-tool to find relevant tools
 * even when the user's query doesn't match the tool name or description.
 * Tags include synonyms, related concepts, Turkish translations, and
 * common intents that should surface each tool.
 *
 * Format: tool_name → array of search keywords
 */

export const TOOL_SEARCH_TAGS: Record<string, readonly string[]> = {
  // ─────────────────────────────────────────────
  // EMAIL
  // ─────────────────────────────────────────────
  send_email: ['mail', 'e-posta', 'gönder', 'mesaj', 'smtp', 'iletişim', 'contact', 'notify', 'bildirim', 'mektup'],
  list_emails: ['mail', 'e-posta', 'inbox', 'gelen kutusu', 'posta', 'read mail', 'check mail'],
  read_email: ['mail', 'e-posta', 'oku', 'open mail', 'message content', 'mesaj oku'],
  delete_email: ['mail', 'e-posta', 'sil', 'remove mail', 'trash', 'çöp'],
  search_emails: ['mail', 'e-posta', 'ara', 'find mail', 'bul', 'filter', 'filtre'],
  reply_email: ['mail', 'e-posta', 'yanıtla', 'cevap', 'respond', 'answer'],

  // ─────────────────────────────────────────────
  // GIT / VERSION CONTROL
  // ─────────────────────────────────────────────
  git_status: ['git', 'version', 'versiyon', 'repo', 'değişiklik', 'changes', 'modified', 'durum'],
  git_diff: ['git', 'fark', 'compare', 'karşılaştır', 'changes', 'diff', 'değişiklik'],
  git_log: ['git', 'geçmiş', 'history', 'commit list', 'log', 'kayıt'],
  git_commit: ['git', 'kaydet', 'save', 'commit', 'version', 'versiyon'],
  git_add: ['git', 'stage', 'ekle', 'add files', 'hazırla'],
  git_branch: ['git', 'dal', 'branch', 'şube', 'branching'],
  git_checkout: ['git', 'geçiş', 'switch', 'checkout', 'dal değiştir'],

  // ─────────────────────────────────────────────
  // MEMORY
  // ─────────────────────────────────────────────
  remember: ['hatırla', 'kaydet', 'save', 'store', 'note', 'memorize', 'not', 'sakla', 'bilgi kaydet'],
  batch_remember: ['hatırla', 'toplu', 'batch', 'bulk save', 'çoklu kaydet'],
  recall: ['hatırla', 'getir', 'retrieve', 'search memory', 'anımsa', 'bul', 'ara', 'sorgula'],
  forget: ['unut', 'sil', 'delete memory', 'remove', 'kaldır', 'temizle'],
  list_memories: ['hatıralar', 'anılar', 'memories', 'kayıtlar', 'listele', 'göster'],
  boost_memory: ['önem', 'priority', 'boost', 'öne çıkar', 'vurgula', 'important'],
  memory_stats: ['istatistik', 'stats', 'memory info', 'hafıza bilgisi', 'durum'],

  // ─────────────────────────────────────────────
  // TASKS / TODO
  // ─────────────────────────────────────────────
  add_task: ['görev', 'yapılacak', 'todo', 'to-do', 'iş', 'plan', 'ekle', 'oluştur', 'create', 'yeni görev', 'hatırlatma', 'reminder'],
  list_tasks: ['görevler', 'yapılacaklar', 'todos', 'listele', 'göster', 'pending', 'bekleyen'],
  complete_task: ['tamamla', 'bitir', 'done', 'finish', 'complete', 'kapat', 'işaretle', 'check'],
  update_task: ['güncelle', 'değiştir', 'edit task', 'modify', 'düzenle', 'task update'],
  delete_task: ['sil', 'kaldır', 'remove task', 'delete', 'iptal'],
  batch_add_tasks: ['toplu görev', 'bulk tasks', 'çoklu', 'batch', 'birden fazla görev'],

  // ─────────────────────────────────────────────
  // NOTES
  // ─────────────────────────────────────────────
  add_note: ['not', 'yaz', 'write', 'kaydet', 'note', 'metin', 'text', 'belge', 'document', 'oluştur'],
  list_notes: ['notlar', 'notes', 'listele', 'göster', 'yazılar', 'belgeler'],
  update_note: ['not güncelle', 'düzenle', 'edit note', 'değiştir', 'modify note'],
  delete_note: ['not sil', 'kaldır', 'remove note', 'delete note'],
  batch_add_notes: ['toplu not', 'bulk notes', 'çoklu not', 'batch notes'],

  // ─────────────────────────────────────────────
  // CALENDAR / EVENTS
  // ─────────────────────────────────────────────
  add_calendar_event: ['takvim', 'etkinlik', 'event', 'randevu', 'appointment', 'toplantı', 'meeting', 'plan', 'schedule', 'ekle', 'oluştur', 'buluşma', 'tarih', 'date'],
  list_calendar_events: ['takvim', 'etkinlikler', 'events', 'randevular', 'program', 'schedule', 'bugün', 'today', 'yarın', 'tomorrow', 'hafta', 'week'],
  delete_calendar_event: ['takvim sil', 'etkinlik sil', 'iptal', 'cancel event', 'remove event'],
  batch_add_calendar_events: ['toplu etkinlik', 'bulk events', 'çoklu randevu', 'batch calendar'],

  // ─────────────────────────────────────────────
  // CONTACTS
  // ─────────────────────────────────────────────
  add_contact: ['kişi', 'rehber', 'contact', 'telefon', 'phone', 'numara', 'number', 'ekle', 'kaydet', 'tanıdık'],
  list_contacts: ['kişiler', 'rehber', 'contacts', 'telefon rehberi', 'listele', 'göster'],
  update_contact: ['kişi güncelle', 'contact update', 'düzenle', 'değiştir'],
  delete_contact: ['kişi sil', 'remove contact', 'kaldır'],
  batch_add_contacts: ['toplu kişi', 'bulk contacts', 'çoklu kişi'],

  // ─────────────────────────────────────────────
  // BOOKMARKS
  // ─────────────────────────────────────────────
  add_bookmark: ['yer imi', 'bookmark', 'favori', 'favorite', 'kaydet', 'link', 'url', 'site', 'web'],
  list_bookmarks: ['yer imleri', 'bookmarks', 'favoriler', 'favorites', 'linkler', 'listele'],
  delete_bookmark: ['yer imi sil', 'remove bookmark', 'favori sil', 'kaldır'],
  batch_add_bookmarks: ['toplu yer imi', 'bulk bookmarks', 'çoklu bookmark'],

  // ─────────────────────────────────────────────
  // EXPENSES / FINANCE
  // ─────────────────────────────────────────────
  add_expense: ['harcama', 'masraf', 'expense', 'para', 'money', 'ödeme', 'payment', 'fatura', 'bill', 'gider', 'cost', 'fiyat', 'price', 'alışveriş', 'shopping'],
  batch_add_expenses: ['toplu harcama', 'bulk expenses', 'çoklu masraf'],
  parse_receipt: ['fiş', 'receipt', 'makbuz', 'fatura', 'invoice', 'oku', 'tara', 'scan'],
  query_expenses: ['harcama sorgula', 'masraf ara', 'expense search', 'filtre', 'filter', 'bütçe', 'budget'],
  export_expenses: ['harcama dışa aktar', 'export', 'rapor', 'report', 'csv', 'excel', 'indır', 'download'],
  expense_summary: ['harcama özeti', 'summary', 'toplam', 'total', 'istatistik', 'analiz', 'analysis', 'bütçe'],
  delete_expense: ['harcama sil', 'remove expense', 'masraf sil'],

  // ─────────────────────────────────────────────
  // FILE SYSTEM
  // ─────────────────────────────────────────────
  read_file: ['dosya oku', 'file read', 'aç', 'open', 'içerik', 'content', 'görüntüle', 'view'],
  write_file: ['dosya yaz', 'file write', 'kaydet', 'save', 'oluştur', 'create file', 'yeni dosya'],
  list_directory: ['klasör', 'dizin', 'folder', 'directory', 'ls', 'listele', 'dosyalar', 'files'],
  search_files: ['dosya ara', 'file search', 'bul', 'find', 'grep', 'arama'],
  download_file: ['indir', 'download', 'fetch', 'getir', 'dosya indir'],
  file_info: ['dosya bilgisi', 'file info', 'boyut', 'size', 'detay', 'detail', 'metadata'],
  delete_file: ['dosya sil', 'file delete', 'kaldır', 'remove file'],
  copy_file: ['dosya kopyala', 'file copy', 'duplicate', 'çoğalt', 'taşı', 'move'],

  // ─────────────────────────────────────────────
  // WEB / API
  // ─────────────────────────────────────────────
  http_request: ['api', 'http', 'rest', 'request', 'istek', 'endpoint', 'fetch', 'call', 'çağır'],
  fetch_web_page: ['web', 'sayfa', 'page', 'site', 'url', 'scrape', 'kazı', 'oku', 'read', 'html'],
  search_web: ['ara', 'search', 'google', 'internet', 'web ara', 'bul', 'find', 'sorgula', 'query', 'bilgi', 'information'],
  json_api: ['json', 'api', 'rest', 'data', 'veri', 'endpoint', 'servis', 'service'],

  // ─────────────────────────────────────────────
  // CODE EXECUTION
  // ─────────────────────────────────────────────
  execute_javascript: ['kod', 'code', 'javascript', 'js', 'çalıştır', 'run', 'script', 'hesapla', 'calculate', 'program'],
  execute_python: ['kod', 'code', 'python', 'py', 'çalıştır', 'run', 'script', 'program', 'hesapla'],
  execute_shell: ['terminal', 'shell', 'bash', 'komut', 'command', 'cmd', 'çalıştır', 'run', 'cli'],
  compile_code: ['derle', 'compile', 'build', 'kod', 'code', 'program'],
  package_manager: ['paket', 'package', 'npm', 'pip', 'install', 'kur', 'yükle', 'dependency', 'bağımlılık'],

  // ─────────────────────────────────────────────
  // IMAGE
  // ─────────────────────────────────────────────
  analyze_image: ['görsel', 'resim', 'image', 'fotoğraf', 'photo', 'analiz', 'analyze', 'tanı', 'describe', 'oku', 'ocr'],
  generate_image: ['görsel oluştur', 'resim üret', 'generate image', 'dall-e', 'ai art', 'çiz', 'draw', 'create image'],
  edit_image: ['görsel düzenle', 'resim edit', 'image edit', 'modify image', 'değiştir'],
  image_variation: ['görsel varyasyon', 'image variation', 'benzer resim', 'similar image'],
  resize_image: ['boyutlandır', 'resize', 'küçült', 'büyüt', 'scale', 'crop', 'kes'],

  // ─────────────────────────────────────────────
  // AUDIO
  // ─────────────────────────────────────────────
  text_to_speech: ['ses', 'audio', 'konuş', 'speak', 'tts', 'oku', 'seslendirme', 'voice', 'ses sentezi'],
  speech_to_text: ['ses tanıma', 'transcribe', 'yazıya dök', 'stt', 'dinle', 'listen', 'audio to text', 'transkript'],
  translate_audio: ['ses çeviri', 'audio translate', 'tercüme', 'dil', 'language'],
  audio_info: ['ses bilgisi', 'audio info', 'süre', 'duration', 'format', 'detay'],
  split_audio: ['ses böl', 'audio split', 'kes', 'cut', 'parçala'],

  // ─────────────────────────────────────────────
  // PDF
  // ─────────────────────────────────────────────
  read_pdf: ['pdf', 'belge', 'document', 'oku', 'read', 'dosya', 'metin çıkar', 'extract text'],
  create_pdf: ['pdf oluştur', 'document create', 'belge oluştur', 'rapor', 'report'],
  pdf_info: ['pdf bilgisi', 'document info', 'sayfa sayısı', 'page count', 'boyut'],

  // ─────────────────────────────────────────────
  // TRANSLATION
  // ─────────────────────────────────────────────
  translate_text: ['çevir', 'translate', 'tercüme', 'dil', 'language', 'İngilizce', 'Türkçe', 'english', 'turkish'],
  detect_language: ['dil algıla', 'detect', 'hangi dil', 'which language', 'tanı'],
  list_languages: ['diller', 'languages', 'desteklenen', 'supported', 'kullanılabilir'],
  batch_translate: ['toplu çeviri', 'bulk translate', 'çoklu', 'batch'],

  // ─────────────────────────────────────────────
  // GOALS
  // ─────────────────────────────────────────────
  create_goal: ['hedef', 'goal', 'amaç', 'objective', 'target', 'plan', 'vizyon', 'oluştur'],
  list_goals: ['hedefler', 'goals', 'amaçlar', 'objectives', 'listele', 'göster'],
  update_goal: ['hedef güncelle', 'goal update', 'düzenle', 'ilerleme', 'progress'],
  decompose_goal: ['hedef böl', 'decompose', 'parçala', 'alt hedefler', 'sub-goals', 'adımlar', 'steps'],
  get_next_actions: ['sonraki adım', 'next action', 'ne yapmalıyım', 'what to do', 'öneri', 'suggestion'],
  complete_step: ['adım tamamla', 'step complete', 'bitir', 'ilerleme kaydet'],
  get_goal_details: ['hedef detay', 'goal detail', 'bilgi', 'info', 'durum', 'status'],
  goal_stats: ['hedef istatistik', 'goal stats', 'ilerleme', 'progress', 'rapor', 'report'],

  // ─────────────────────────────────────────────
  // SCHEDULER
  // ─────────────────────────────────────────────
  create_scheduled_task: ['zamanlı görev', 'schedule', 'cron', 'otomasyon', 'automation', 'timer', 'otomatik', 'automatic', 'tekrar', 'recurring', 'hatırlatma', 'reminder'],
  list_scheduled_tasks: ['zamanlı görevler', 'schedules', 'cron list', 'otomasyonlar', 'listele'],
  update_scheduled_task: ['zamanlı güncelle', 'schedule update', 'düzenle'],
  delete_scheduled_task: ['zamanlı sil', 'schedule delete', 'iptal', 'cancel'],
  get_task_history: ['görev geçmişi', 'task history', 'çalışma kaydı', 'execution log'],
  trigger_task: ['tetikle', 'trigger', 'çalıştır', 'run now', 'hemen çalıştır', 'manual run'],

  // ─────────────────────────────────────────────
  // DATA EXTRACTION
  // ─────────────────────────────────────────────
  extract_structured_data: ['yapılandırılmış veri', 'structured data', 'parse', 'ayrıştır', 'extract', 'çıkar', 'json', 'tablo'],
  extract_entities: ['varlık çıkarma', 'entity extraction', 'ner', 'isim', 'name', 'tarih', 'date', 'yer', 'place'],
  extract_table_data: ['tablo', 'table', 'csv', 'excel', 'veri çıkar', 'parse table'],
  summarize_text: ['özetle', 'summarize', 'kısalt', 'özet', 'summary', 'brief', 'tldr'],

  // ─────────────────────────────────────────────
  // CUSTOM DATA
  // ─────────────────────────────────────────────
  list_custom_tables: ['veritabanı', 'database', 'tablo', 'table', 'listele', 'göster', 'schema'],
  describe_custom_table: ['tablo bilgisi', 'table info', 'yapı', 'structure', 'sütunlar', 'columns'],
  create_custom_table: ['tablo oluştur', 'create table', 'veritabanı', 'database', 'yeni tablo'],
  delete_custom_table: ['tablo sil', 'drop table', 'kaldır'],
  add_custom_record: ['kayıt ekle', 'add record', 'insert', 'veri ekle', 'satır ekle', 'row'],
  batch_add_custom_records: ['toplu kayıt', 'bulk insert', 'çoklu veri'],
  list_custom_records: ['kayıtlar', 'records', 'listele', 'veriler', 'data', 'satırlar', 'rows'],
  search_custom_records: ['kayıt ara', 'search records', 'bul', 'filtre', 'sorgula', 'query'],
  get_custom_record: ['kayıt getir', 'get record', 'detay', 'tek kayıt'],
  update_custom_record: ['kayıt güncelle', 'update record', 'düzenle', 'değiştir'],
  delete_custom_record: ['kayıt sil', 'delete record', 'kaldır'],

  // ─────────────────────────────────────────────
  // VECTOR SEARCH
  // ─────────────────────────────────────────────
  create_embedding: ['embedding', 'vektör', 'vector', 'gömme', 'encode', 'semantik', 'semantic'],
  semantic_search: ['semantik arama', 'semantic search', 'benzerlik', 'similarity', 'anlam', 'meaning', 'akıllı arama'],
  upsert_vectors: ['vektör ekle', 'upsert', 'vector add', 'güncelle'],
  delete_vectors: ['vektör sil', 'vector delete', 'kaldır'],
  list_vector_collections: ['koleksiyonlar', 'collections', 'vektör listele', 'vector list'],
  create_vector_collection: ['koleksiyon oluştur', 'create collection', 'yeni koleksiyon'],
  similarity_score: ['benzerlik skoru', 'similarity score', 'karşılaştır', 'compare', 'yakınlık'],

  // ─────────────────────────────────────────────
  // WEATHER
  // ─────────────────────────────────────────────
  get_weather: ['hava', 'weather', 'sıcaklık', 'temperature', 'derece', 'yağmur', 'rain', 'güneş', 'sun', 'hava durumu', 'bugün'],
  get_weather_forecast: ['hava tahmini', 'forecast', 'yarın', 'tomorrow', 'haftalık', 'weekly', 'tahmin', 'prediction'],

  // ─────────────────────────────────────────────
  // UTILITY / MATH / TEXT
  // ─────────────────────────────────────────────
  get_current_datetime: ['saat', 'time', 'tarih', 'date', 'zaman', 'şimdi', 'now', 'bugün', 'today', 'saat kaç'],
  calculate: ['hesapla', 'calculate', 'matematik', 'math', 'toplama', 'çarpma', 'formül', 'formula', 'işlem', 'operation'],
  convert_units: ['dönüştür', 'convert', 'birim', 'unit', 'metre', 'kilo', 'fahrenheit', 'celsius', 'cm', 'inch', 'dolar', 'euro', 'tl'],
  generate_uuid: ['uuid', 'id', 'benzersiz', 'unique', 'tanımlayıcı', 'identifier'],
  generate_password: ['şifre', 'password', 'parola', 'güvenli', 'secure', 'random', 'rastgele'],
  random_number: ['rastgele sayı', 'random number', 'şans', 'luck', 'dice', 'zar'],
  hash_text: ['hash', 'md5', 'sha', 'şifrele', 'encrypt', 'digest', 'özet'],
  encode_decode: ['encode', 'decode', 'base64', 'url encode', 'şifrele', 'çöz', 'kodla'],
  count_text: ['say', 'count', 'kelime sayısı', 'word count', 'karakter', 'character', 'satır', 'line'],
  extract_from_text: ['metin çıkar', 'extract', 'regex', 'pattern', 'desen', 'bul', 'parse'],
  validate: ['doğrula', 'validate', 'kontrol', 'check', 'geçerli mi', 'email', 'url', 'telefon', 'phone'],
  transform_text: ['metin dönüştür', 'transform', 'büyük harf', 'uppercase', 'küçük harf', 'lowercase', 'trim', 'replace', 'değiştir'],
  date_diff: ['tarih farkı', 'date diff', 'kaç gün', 'how many days', 'süre', 'duration', 'aradaki fark'],
  date_add: ['tarih ekle', 'date add', 'gün ekle', 'add days', 'sonraki', 'next', 'önceki', 'previous'],
  format_json: ['json format', 'prettify', 'düzenle', 'güzelleştir', 'indent'],
  parse_csv: ['csv oku', 'csv parse', 'tablo', 'excel', 'veri oku'],
  generate_csv: ['csv oluştur', 'csv generate', 'tablo oluştur', 'export', 'dışa aktar'],
  array_operations: ['dizi', 'array', 'liste', 'list', 'sırala', 'sort', 'filtre', 'filter', 'unique', 'benzersiz'],
  statistics: ['istatistik', 'statistics', 'ortalama', 'average', 'mean', 'median', 'standart sapma', 'std', 'toplam', 'sum'],
  compare_text: ['metin karşılaştır', 'compare', 'fark', 'diff', 'benzerlik', 'similarity'],
  regex: ['regex', 'düzenli ifade', 'regular expression', 'pattern', 'desen', 'eşleşme', 'match'],
  system_info: ['sistem', 'system', 'bilgi', 'info', 'platform', 'os', 'bellek', 'memory', 'cpu'],

  // ─────────────────────────────────────────────
  // DYNAMIC TOOLS (meta)
  // ─────────────────────────────────────────────
  create_tool: ['araç oluştur', 'tool create', 'yeni araç', 'custom tool', 'özel araç'],
  list_custom_tools: ['araçlar', 'tools', 'listele', 'custom tools', 'özel araçlar'],
  delete_custom_tool: ['araç sil', 'tool delete', 'kaldır'],
  toggle_custom_tool: ['araç aç/kapat', 'tool toggle', 'etkinleştir', 'enable', 'devre dışı', 'disable'],

  // ─────────────────────────────────────────────
  // CONFIG CENTER
  // ─────────────────────────────────────────────
  config_list_services: ['ayarlar', 'settings', 'servisler', 'services', 'config', 'yapılandırma', 'api key', 'listele'],
  config_get_service: ['ayar', 'setting', 'config', 'servis bilgisi', 'api key', 'detay'],
  config_set_entry: ['ayar değiştir', 'config set', 'api key ekle', 'yapılandır', 'configure'],
};
