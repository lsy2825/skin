"""scrape/verify_prices.py check(): how a low price is matched on its source page, on small pages shaped like the real ones.
usage: python tests/verify_prices_test.py   (no network)"""
import os, sys, unittest
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scrape"))
from verify_prices import check, spaced  # noqa: E402

NAME = "[1회 체험가] 점제거 1개 (2mm이하)"


def run(html, name=NAME, price=990, others=()):
    soup = BeautifulSoup(html, "html.parser")
    return check(soup, spaced(soup.get_text(" ")), name, price, set(others))[0]


class Check(unittest.TestCase):
    def test_numbers_in_separate_tags_stay_separate(self):
        # 쁨 홍대점 (2026-10-13): discount, sale and list price in three tags right after the name. Squashing every space
        # read them as '49%9901,950', so 990 was not seen (NAME_ONLY).
        html = f"<li><strong>{NAME}</strong><p>*최대 10개까지 가능 ▶이벤트기간: ~2026.10.31까지</p><p><em>49%</em><b>990</b><span>1,950</span></p></li>"
        self.assertEqual(run(html), "FOUND")

    def test_one_number_written_together_is_not_split(self):
        html = f"<li><strong>{NAME}</strong><p>9901,950</p></li>"
        self.assertEqual(run(html), "NAME_ONLY")

    def test_long_description_same_box(self):
        # 쁨 부산점: a long description sits between the name and the price, inside the same product box
        desc = "작은 점부터 크고 깊은 점까지 효과적으로 제거 가능한 다양한 색소 전용 레이저 기기를 사용하여 개인 맞춤형 점제거가 가능합니다. " * 3
        html = (f"<div class='item'><label>{NAME}</label><p>{desc}</p><div class='sel'><span>990원</span><s>1,950원</s></div></div>"
                "<div class='item'><label>듀얼토닝 1회</label><div class='sel'><span>69,000원</span></div></div>")
        self.assertEqual(run(html, others=["듀얼토닝 1회"]), "IN_BLOCK")

    def test_price_of_the_next_product_does_not_count(self):
        # the name's own box has no price; the next product happens to cost the same
        desc = "설명 " * 120
        html = (f"<div class='item'><label>{NAME}</label><p>{desc}</p></div>"
                "<div class='item'><label>비타민관리 체험가</label><span>990원</span></div>")
        self.assertEqual(run(html, others=["비타민관리 체험가"]), "NAME_ONLY")

    def test_price_inside_the_name_does_not_count(self):
        self.assertEqual(run("<li><b>체험가 990원 아쿠아필</b><span>2,900원</span></li>", name="체험가 990원 아쿠아필"), "NAME_ONLY")

    def test_name_split_over_tags_and_missing(self):
        self.assertEqual(run(f"<li><b>[1회 체험가]</b> <i>점제거 1개</i> (2mm이하) <span>990원</span></li>"), "FOUND")
        self.assertEqual(run("<li><b>다른 상품</b><span>990원</span></li>"), "NOT_FOUND")

    def test_trailing_kind_word_may_be_missing_on_the_page(self):
        self.assertEqual(run("<li><b>주름보톡스(국산 일반형)</b> <span>800원</span></li>", name="주름보톡스(국산 일반형) 체험가", price=800), "FOUND")


if __name__ == "__main__":
    unittest.main()
