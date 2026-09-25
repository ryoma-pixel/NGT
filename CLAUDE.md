# NINJA GO TOURS 公式サイト（ninjagotours.com）リニューアル

このリポジトリは NGT 公式サイトの新しい実装です。Claude のセッションが替わっても作業を続けられるよう、決定事項と残作業をここにまとめています。

## 事業の前提
- 運営：株式会社Kiranah Resort。NGT は東京（新宿・上野・浅草）の忍者ガイド付きウォークツアー事業。
- 以前は NINJA GO RIDE（電動キックボード）単体のLPだった。交通・運転リスクとコストの理由で RIDE は縮小し、ウォークツアーを量産する「ツアー代理店型」の公式サイトに方針転換した。
- 関係者：Reelu（外国語ガイド派遣）、IGLOOO（広告運用。広告の遷移先は公式トップ）、LINKTIVITY（直販予約エンジン・OTA連携の代理店）。
- 予約エンジンは LINKTIVITY 系を続投する。予約データ上の公式直販チャネル名は `ARS_NINJAGORIDE`。

## 分析で分かったこと（2026-09-25 時点）
- 出典：LINKTIVITY 予約CSV（購入日 2025/9/1〜2026/9/24、147件・確定96件）。**CSVは顧客の個人情報を含むため、リポジトリに入れない**（`.gitignore` で `*.csv` を除外済み）。
- 公式直販は 2025/9〜2026/1 に確定27件（最大のチャネル）→ 2026/2〜9 は12件に減少。RIDE からウォークツアーへの切替時期と一致。
- ウォークツアーは確定52件がほぼすべて単独催行（催行51回）。1〜2名の催行が66%。現行の一律¥2,500では、51回中34回が赤字（試算）。
- GA4（直近30日：8/8〜9/6）：セッション2,026、エンゲージメント率29.9%、キーイベント67件。キーイベントの定義が予約完了と一致していない可能性が高い。
- サーチコンソール：クリックはほぼ指名検索（「ninja go tours」平均1.3位）のみ。ツアーページは指名検索でも13位前後。

## 決定事項
1. **価格（確定）**：大人1名あたり、1名¥8,000／2名¥4,000／3名¥2,800／4名以上¥2,500。`src/data/pricing.json`。
   - 試算：`docs/pricing/NGT_価格モデル.xlsx`。Reelu 特別単価（最初の6ヶ月）では全人数で黒字、通常単価に戻ると1〜3名が赤字 → 特別単価の終了前に単価交渉か価格改定が必要。
   - OTA価格は公式価格 ÷（1 − OTA手数料率）で上乗せする。公式が最安になるようにする。
   - 子ども：現行は「12歳以下無料」。サイトの文言は「大人1名につき子ども1名まで無料」（提案段階・**ご本人の最終確認待ち**）。
2. **サイト基盤（確定）**：STUDIO をやめ、このリポジトリ（Astro 5 の静的サイト）を Netlify 無料枠で公開する。更新は Pages CMS（`.pages.yml`）の入力フォームで行う。
3. **公開方針**：9/30 に v1 を公開し、10月に改善（v2）。

## デザイン方針（2026-09-25 ご本人指示）
- キーワード：**わくわく感・没入感／驚き／日本人と外国人の笑顔の対話／日本らしさ**。淡い和紙・桜色の案は「ワクワク感が伝わらない・色が微妙」で却下済み。
- 現行：夜の東京をベースにした没入型。紺黒（`--night`）＋提灯の金（`--lantern`）＋朱（`--shu`）、見出しは丸ゴシック（Zen Maru Gothic）、英語見出しに日本語の小見出し。トップは実写のフルスクリーン・スライドショー（ゆっくりズーム）＋ガイドと旅行者の吹き出し。ツアーカードは写真全面＋文字重ね。
- 写真の出典：Google Drive「04_NINJA GO TOURS / 02_ツアー / 各ツアー / 素材_〜」。`public/images/` に最適化済み（WebP）。スライドの元画像：秘境神社 DSA00648、新宿御苑 DSC_0302、ゴールデン街 DSC_0455。
- 使わないもの：AIで生成したと思われる人物写真（ハンコ素材 9.jpg など）は、実在の参加者と誤認されるため使わない。既存のサムネイル画像は綴りの誤り（GOLDEN GUI／GTYOEN／LGTBQ）があるため使わない。
- 1024px程度のストック風画像（浅草 I 系、上野 G 系など）は大きく表示すると粗い。高解像度版かAdobe Stockで差し替える。
- 口コミ：Drive の「NGT_英語口コミ一覧_20260908」に実際のレビューがある。掲載できる範囲を確認してから使う（捏造しない）。

## 技術構成
- Astro 5、`trailingSlash: 'never'`、`build.format: 'file'` → 旧サイトと同じ `/tour/slug` 形式のURLを出力する。
- ツアー：`src/content/tours/*.md`（ファイル名＝URLのslug）。コラム：`src/content/columns/*.md`。
- `draft: true` のコンテンツは、Netlify の本番（`CONTEXT=production`）では出力されない。プレビューとローカルでは DRAFT 表示付きで出る。
- 計測：`src/data/site.json` の `gtmId`（優先）または `ga4MeasurementId` を設定する。`data-track` 属性のクリックで `click_book`／`click_ota`／`click_tour_card`／`click_map` などのイベントを送る。
- コマンド：`npm run build`（型チェック込み）、`npm run dev`。

## 旧サイトのURL（すべて維持すること）
サーチコンソールで確認済みのURL：
- `/`、`/tours`、`/column`、`/term`、`/comic-lp`（GBPのリンク先）、`/ninjagoride`
- `/tour/shinjuku-secret-shrine`、`/tour/goldengai-nightlife`、`/tour/shinjuku-hanko`、`/tour/shinjuku-nichome-lgbtq`、`/tour/shinjuku-gyoen-sakura`、`/tour/shinjuku-escooter-ride`
- `/area/Shinjuku`、`/area/Asakusa`、`/area/Osaka`、`/theme/Entertainment`、`/theme/E-Scooter`、`/theme/FourSeasons`
- `/column/` 配下：`ueno-izakaya-guide`、`shinjuku-center-gai-guide`、`ninja-shinjuku-family`、`shinjuku-kawaii-vintage-shops`、`shinjuku-retro-unique-souvenirs`、`kappabashi-family-guide`、`kappabashi-shopping-guide`、`shinjuku-showa-retro-cafes`、`best-japanese-goods-shinjuku`、`shinjuku-golden-gai-guide`

## 残作業（v1 公開の前に必須）
`ninjagotours.com` にこの環境からアクセスできる必要がある（環境のネットワーク設定で許可ドメインに追加）。
- [ ] 旧サイトの全ページをクロールし、URL一覧を上の表と突き合わせる（漏れたURLは `public/_redirects` で301転送する）。
- [ ] ツアー8本の英文、写真、開始時刻、集合場所、`bookingUrl`（LINKTIVITY直販ページ）、OTAのレビューリンクを移行し、`draft: false` にする。上野・浅草の3本はslugが推測のため、旧URLに合わせてファイル名を変える。
- [ ] コラム10本を移行する（本文・画像）。移行しないと検索流入を失う。
- [ ] `/term`（利用規約・キャンセルポリシー）、`/comic-lp`、`/ninjagoride` を移行する。`/tour/shinjuku-escooter-ride` の扱い（残す／転送）をご本人に確認する。
- [ ] ロゴとブランドカラーを旧サイトから取り込む（現在は仮デザイン）。
- [ ] GTM か GA4 のIDを `site.json` に設定する。予約エンジン（別ドメイン）とのクロスドメイン計測を GA4 側で設定し、キーイベントを「予約完了」に定義し直す。
- [ ] 価格の同時切替：LINKTIVITY で公式の段階制料金とOTAの上乗せ価格を**サイト公開と同じ日に**反映する（OTAが旧価格のままだと「公式が最安」の表記が事実と合わなくなる）。人数別の料金をOTAで設定できない場合は、人数別プランに分ける。
- [ ] 子ども料金の文言をご本人に最終確認する。
- [ ] `.pages.yml` の設定を、Pages CMS に初回ログインした時点で動作確認する（FAQのリスト形式など）。

## 公開手順（ご本人の作業・手順書を別途用意）
1. Netlify のアカウントを作成し、このGitHubリポジトリを接続する（ビルド設定は `netlify.toml` 済み）。
2. Netlify でカスタムドメイン `ninjagotours.com` を追加する。
3. 現在のDNSでは、Webサイト用のレコード（Aレコード／www の CNAME）だけを Netlify 向けに変える。**ネームサーバーは変えず、MXなど Google Workspace のレコードには触れない**。
4. STUDIO の公開を停止するのは、新サイトの表示とSSLを確認してから。
