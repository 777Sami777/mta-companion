# 4Life Companion

Darmowa aplikacja na Windows dla graczy serwera **4Life MTA**: sesje, zarobki, znajomi, mapa z giełdami, pojazdy, tuning i prace dorywcze w jednym oknie.

**[⬇ Pobierz najnowszą wersję](https://github.com/777Sami777/mta-companion/releases/latest)**: plik `4LifeCompanionSetup.exe` (instalator) albo sam `4LifeCompanion.exe`.

## Co potrafi

| Zakładka | Funkcje |
|---|---|
| **Dziś** | Czas gry, zarobek, wypłaty i LP z dzisiaj, obecna sesja, znajomi online, gracze na serwerze |
| **Zarobki / Sesje** | Zarobki dzień po dniu, zarobek na godzinę, lista sesji z długością i zarobkiem |
| **Znajomi** | Lista uzupełniana z gry, status online i czas sesji, notatki |
| **Pojazdy / Tuning / Prace dorywcze** | Dane z wiki serwera: ceny, salony, prędkości, części z kosztem, zarobki na poziom |
| **Mapa** | Giełdy, salony, prace, frakcje i inne miejsca z ikonami |
| **Serwer** | Gracze online z wyszukiwarką |

## Bezpieczeństwo

- Aplikacja **nie ingeruje w grę** i nie czyta jej pamięci. Korzysta tylko z logów i cache, które MTA samo zapisuje na dysku, publicznego statusu serwera i publicznej wiki 4Life.
- Twoje dane zostają na Twoim komputerze (`%APPDATA%\4LifeCompanion`).
- Grafiki i dane serwera są czytane z Twojego cache MTA i wiki, nie są dołączone do programu.
- To projekt fanowski, niezwiązany z 4Life MTA.

## Budowanie ze źródeł

```bash
pip install pywebview pyinstaller pillow
python -m PyInstaller --noconfirm --onefile --windowed --name 4LifeCompanion --icon icon.ico --add-data "web;web" main.py
```

Instalator: skopiuj `dist/4LifeCompanion.exe` i plik `version.txt` z wersją do `setup_build/`, potem:

```bash
python -m PyInstaller --noconfirm --onefile --windowed --name 4LifeCompanionSetup --icon icon.ico --add-data "setup_build/4LifeCompanion.exe;." --add-data "setup_build/version.txt;." setup.py
```

## Wydania

Aplikacja sprawdza najnowsze wydanie tego repozytorium. Nowa wersja: podnieś `APP_VERSION` w `main.py`, zbuduj oba pliki i dodaj wydanie z tagiem `vX.Y.Z` oraz plikami `4LifeCompanion.exe` i `4LifeCompanionSetup.exe`.
