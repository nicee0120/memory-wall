# VibeVibe Memory Wall

10.000 hücrelik ortak hafıza duvarı. Her ziyaretçi boş bir hücre seçip isim, isteğe bağlı X kullanıcı adı, en fazla 280 karakterlik bir mesaj ve isteğe bağlı bir görsel bırakabilir. Herkes aynı duvarı görür.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `index.html` | Sitenin kendisi |
| `config.js` | Supabase adresin ve anahtarın (sadece bunu düzenleyeceksin) |
| `supabase-setup.sql` | Veritabanı, güvenlik kuralları ve görsel deposu kurulumu |

## 1. Supabase kurulumu (bir kez, ücretsiz plan yeterli)

1. supabase.com'da hesap aç, **New project** de. Bir isim ver, şifre belirle, bölge olarak sana yakın birini seç (ör. Frankfurt).
2. Proje açılınca soldaki menüden **SQL Editor → New query**'ye gir.
3. `supabase-setup.sql` dosyasının tamamını kopyalayıp yapıştır, **Run**'a bas. "Success" görmen lazım.
4. Soldan **Project Settings → API**'ye gir. İki değeri kopyala:
   - **Project URL** (örn. `https://abcd1234.supabase.co`)
   - **anon public** anahtarı (uzun yazı)
5. `config.js` dosyasını aç ve bu iki değeri tırnakların arasına yapıştır.

⚠️ **service_role** anahtarını asla `config.js`'e koyma. O gizli anahtardır. `anon public` anahtarı ise herkese açık olacak şekilde tasarlanmıştır; verileri SQL dosyasındaki güvenlik kuralları korur.

## 2. Vercel'de yayınlama

1. GitHub'da yeni bir repo aç (örn. `memory-wall`).
2. **uploading an existing file** ile `index.html`, `config.js`, `supabase-setup.sql` ve `README.md` dosyalarını yükle.
3. vercel.com → **Add New → Project** → repoyu **Import** et → hiçbir ayarı değiştirmeden **Deploy**.

Güncelleme yapmak için dosyayı GitHub'da yeniden yüklemen yeterli; Vercel kendiliğinden günceller.

## 3. Çalıştığını kontrol et

- Site açılınca üstte "veritabanına bağlı değil" uyarısı **görünmemeli**. Görünüyorsa `config.js` boş ya da yanlış.
- Bir hücreye görselli bir anı bırak, sayfayı başka bir cihazda aç: anı orada da görünmeli.
- Supabase → **Table Editor → memories** tablosunda yeni satırı görmelisin.

## Güvenlik ve koruma

- Bir hücreye sadece **bir** anı yazılabilir. Veritabanındaki `unique` kuralı sayesinde iki kişi aynı anda kaydetse bile sadece biri başarılı olur, diğerine "başka bir hücre seç" mesajı çıkar ve yazdığı metin kaybolmaz.
- Ziyaretçiler tabloya doğrudan yazamaz, değiştiremez, silemez. Her kayıt `claim_cell` fonksiyonundan geçer; isim, mesaj, X kullanıcı adı ve görsel yolu sunucuda tekrar kontrol edilir.
- Spam sınırı: bir ziyaretçi 10 dakikada en fazla 3, günde en fazla 20 anı bırakabilir. Formda bot tuzağı ve çok hızlı gönderim kontrolü de var.
- Görseller tarayıcıda küçültülür (en fazla 1200 px ve 128 px küçük resim). Depo sadece 5 MB altı JPEG/PNG/WebP kabul eder; dosyaların üzerine yazılamaz.

## Moderasyon

- Her anıda **Report** butonu var. 3 farklı kişi bildirirse anı otomatik gizlenir; hücre dolu kalır.
- Bildirimleri görmek için: Supabase → **Table Editor → reports**.
- Gizlenen anıyı geri açmak için: **memories** tablosunda o satırın `hidden` değerini `false` yap.
- Bir anıyı tamamen silmek için: **memories** tablosunda satırı sil (hücre tekrar boşalır). Görseli de silmek istersen **Storage → memory-images** içinden `image_path` ve `thumb_path`'teki dosyaları sil.

## Bilinen sınırlar

- Anlık güncelleme, Supabase'in "broadcast" özelliğiyle yapılıyor; çalışmazsa duvar yine her 45 saniyede bir ve **Refresh** butonuyla yenilenir.
- Görsel yüklendikten sonra kayıt başarısız olursa depoda sahipsiz bir görsel kalabilir. Zararsızdır, istersen Storage'dan silebilirsin.
- Spam koruması IP tabanlıdır. Ciddi bir saldırıda Cloudflare Turnstile gibi bir doğrulama eklemek gerekir.
