"""Align the existing sentence pinyin; do not retranslate or regenerate pronunciation.
Usage: python3 build_sentence_ruby.py /path/to/Unihan_Readings.txt
Reference: https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
"""
from functools import lru_cache
import json
from pathlib import Path
import re
import sys
import unicodedata


def plain(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if not unicodedata.combining(c) or c == '\u0308')


def readings(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if not line.startswith('U+'): continue
        code, field, value = line.split('\t', 2)
        if field not in {'kMandarin', 'kHanyuPinyin', 'kXHC1983', 'kHanyuPinlu'}: continue
        syllables = re.findall(r'[a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜêńňǹḿ]+', value)
        result.setdefault(chr(int(code[2:], 16)), set()).update(plain(s) for s in syllables)
    return result


def align(sentence, pinyin, dictionary):
    # Keep spaces as syllable boundaries; joined words are matched against their characters.
    pieces = re.findall(r'[^\W\d_]+|[^\w\s]', unicodedata.normalize('NFC', pinyin), re.UNICODE)
    stream = '|'.join(pieces)
    @lru_cache(None)
    def walk(i, j):
        while j < len(stream) and not stream[j].isalpha(): j += 1
        if i == len(sentence): return [()] if j == len(stream) else []
        char = sentence[i]
        if not '\u3400' <= char <= '\u9fff':
            return [((char, ''),) + rest for rest in walk(i + 1, j)]
        matches = []
        for end in range(j + 1, min(len(stream), j + 8) + 1):
            syllable = stream[j:end]
            if not syllable.isalpha(): break
            base = plain(syllable)
            if base in dictionary.get(char, set()) and not (char == '儿' and base == 'r'):
                matches += [((char, syllable),) + rest for rest in walk(i + 1, end)]
            if sentence[i + 1:i + 2] == '儿' and base.endswith('r') and base[:-1] in dictionary.get(char, set()):
                matches += [((char + '儿', syllable),) + rest for rest in walk(i + 2, end)]
        return matches
    matches = walk(0, 0)
    if len(matches) != 1:
        raise ValueError(f'{len(matches)} alignments: {sentence} / {pinyin}')
    return [dict(text=h, pinyin=p) for h, p in matches[0]]


if __name__ == '__main__':
    dictionary = readings(sys.argv[1])
    path = Path(__file__).parent / 'public/deck.json'
    cards = json.loads(path.read_text())
    for card in cards:
        card['sentence_ruby'] = align(card['sentence'], card['sentence_pinyin'], dictionary)
    path.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + '\n')
    print(f'Aligned {len(cards)} sentences, preserving their original pinyin.')
