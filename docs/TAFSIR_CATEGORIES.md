# Tafsir categories — 2026-10-27

English appears first, followed by the nine user-supplied groups in their requested order and Concise. Categories overlap. Existing IDs are retained where a category was renamed so saved filters continue to resolve. The four hidden catalog records omitted from the request retain their existing memberships and remain hidden. No book identities or other metadata change.

## Memberships

### English

Maududi, Ibn Kathir, Muyassar, Jalalayn, Maarif, Wahiduddin, Mokhtasar, Easy Tajwid, Muntakhab, Asbab, Ünal, Dawat, Ishraq, Yusuf Ali

### Classical

Tabari, Samarqandi, Ibn Abu Zamanin, Thalabi, Makki b. Abu Talib, Mawardi, Wahidi-Basit, Wahidi-Wajiz, Samaani, Baghawi, Zamakhshari, Ibn Atiyyah, Ibn al-Jawzi, Razi, Qurtubi, Baydawi, Nasafi, Abu Hayyan, Ibn Juzay, Ibn Kathir

### Comprehensive

Tabari, Thalabi, Razi, Qurtubi, Abu Hayyan, Ibn Adil, Alusi, Qasimi, Ibn Ashur, Mathur, Dorar al-Saniyyah

### Narrations

Tabari, Samarqandi, Ibn Abu Zamanin, Thalabi, Samaani, Baghawi, Ibn Kathir, Suyuti, Mathur

### Interpretive

Mawardi, Ibn al-Jawzi, Razi, Baydawi, Nasafi, Ibn Juzay, Jalalayn, Iji, Shawkani, Qinnawji, Alusi, Qasimi, Rida, Saadi, Maududi, Ibn Ashur, Maarif, Ibn al-Uthaymin, Jazairi, Wahiduddin, Muyassar, Mokhtasar, Shawi, Yaseer, Muntakhab, Tantawi, Ünal, Dawat, Ishraq, Yusuf Ali, Dorar al-Saniyyah

### Legal

Qurtubi, Ibn Juzay, Shanqiti, Maarif, Ibn al-Uthaymin

### Language

Makki b. Abu Talib, Wahidi-Basit, Zamakhshari, Ibn Atiyyah, Baydawi, Nasafi, Abu Hayyan, Ibn Adil, Ibn Ashur, Qiraat, Khudayri, Irab, Irab (Daas)

### Coherence

Biqaii, Ibn Ashur, Tadabbur, Shanqiti

### Modern

Shawkani, Alusi, Qinnawji, Qasimi, Rida, Saadi, Maududi, Ibn Ashur, Shanqiti, Maarif, Ibn al-Uthaymin, Jazairi, Wahiduddin, Muyassar, Mokhtasar, Tadabbur, Mathur, Irab, Irab (Daas), Khudayri, Shawi, Yaseer, Muntakhab, Tantawi, Dorar al-Saniyyah, Ünal, Dawat, Ishraq, Yusuf Ali

### Study Aids · Specialized resources for Quran study

Easy Tajwid, Asbab, Qiraat, Irab, Irab (Daas), Khudayri

### Concise

Ibn Abu Zamanin, Wahidi-Wajiz, Ibn al-Jawzi, Baydawi, Nasafi, Ibn Juzay, Jalalayn, Iji, Saadi, Jazairi, Wahiduddin, Muyassar, Mokhtasar, Shawi, Yaseer, Muntakhab


## Concise

Retains the 16 previously reviewed brief commentaries and abridgments. It is a format category, not simply a test of imported file size: a partial or specialized resource is not necessarily a concise tafsir.

## English coverage

English membership requires nonblank English commentary in at least 90% of stored passages containing Arabic or English commentary. Footnotes alone do not count. The denominator is available commentary passages, not all Quran verses, and this does not certify translation quality or completeness of the imported edition. The audited counts are stored in `bin/utils/tafsir-category-review.json`. Refresh the audit after commentary imports or translation work.

| Work | English passages | Commentary passages | Coverage |
| --- | ---: | ---: | ---: |
| Maududi | 1910 | 1910 | 100.00% |
| Ibn Kathir | 1911 | 1913 | 99.90% |
| Muyassar | 5040 | 5040 | 100.00% |
| Jalalayn | 6237 | 6237 | 100.00% |
| Maarif | 3062 | 3062 | 100.00% |
| Wahiduddin | 1972 | 1972 | 100.00% |
| Mokhtasar | 6237 | 6237 | 100.00% |
| Easy Tajwid | 11 | 11 | 100.00% |
| Muntakhab | 1113 | 1113 | 100.00% |
| Asbab | 445 | 445 | 100.00% |
| Ünal | 6237 | 6237 | 100.00% |
| Dawat | 557 | 557 | 100.00% |
| Ishraq | 557 | 557 | 100.00% |
| Yusuf Ali | 6237 | 6237 | 100.00% |

## Apply and verification

Run `node bin/utils/reclassify-tafsir-books.js` to preview and add `--apply` to write. The migration checks reviewed identities and prior membership hashes, preserves unrelated properties and non-tafsir groups, backs up records, verifies writes in a transaction, and is idempotent. This does not deploy application code or refresh running application caches.
