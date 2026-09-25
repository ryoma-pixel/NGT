# NGT新サイト 公開手順書

作成日：2026-09-25　対象：ninjagotours.com（STUDIO → Netlify へ移行）

**所要時間の目安**：合計60〜90分（DNSの反映待ちを除く）

**大原則**：メール（Google Workspace）に関わる設定には触れません。変えるのは「Webサイトの向き先」だけです。

---

## STEP 1｜Netlifyにサイトを作る（15分）
1. https://app.netlify.com を開き、「Sign up」→「GitHub」でログインします（`ryoma-pixel` のアカウント）。
2. 「Add new project」→「Import an existing project」→「GitHub」を選びます。
3. リポジトリ一覧から **ryoma-pixel/NGT** を選びます。
4. 「Branch to deploy」は、公開前の確認中は `claude/ninja-go-tours-website-redesign-0vzadh` を選びます。
   - 公開時は、私が用意する main への反映（プルリクエスト）をマージしたうえで `main` に切り替えます。
5. ビルドの設定欄はそのままで構いません（`netlify.toml` で設定済み）。「Deploy」を押します。
6. 数分後、`〇〇〇.netlify.app` というURLでサイトが表示されれば成功です。**このURLを私に共有してください。**

> 確認用URLでは、下書き（DRAFT）のツアーも表示されます。本番URLでは表示されません。

## STEP 2｜お問い合わせフォームを有効にする（5分）
1. Netlifyのサイト画面で「Forms」を開き、「Enable form detection」を押します。
2. 「Forms」→「Form notifications」→「Add notification」→「Email notification」で、受信するメールアドレスを登録します。
3. 登録後にもう一度デプロイし（「Deploys」→「Trigger deploy」）、`/contact` から試しに1通送って届くか確認します。

## STEP 3｜ドメインをNetlifyに向ける（15分＋反映待ち）
1. Netlifyで「Domain management」→「Add a domain」→ `ninjagotours.com` を入力します。
2. 「Netlify DNSを使うか」と聞かれたら、**使わない**（外部DNSのまま）を選びます。
3. Netlifyの画面に、設定すべき値が表示されます。
4. ドメインを管理している会社のDNS設定画面で、**次の2つだけ**を変更します。

| 種類 | ホスト名 | 値 |
|---|---|---|
| A | `@`（ninjagotours.com） | Netlifyが表示するIP（通常 `75.2.60.5`） |
| CNAME | `www` | `〇〇〇.netlify.app` |

   - **触らないもの**：MX、TXT（`google-site-verification` など）、そのほかのレコード。
   - 変更前に、今のDNS設定画面のスクリーンショットを保存してください（元に戻すときに使います）。
5. 反映には数分〜最大48時間かかります。反映されると、NetlifyでHTTPS（SSL証明書）が自動で有効になります。
6. `https://ninjagotours.com` で新サイトが表示され、鍵マークが付いていることを確認します。

## STEP 4｜STUDIOを止める（5分）
新サイトの表示とSSLを確認してから行います。
1. STUDIOのプロジェクト設定で、独自ドメイン `ninjagotours.com` の接続を解除し、公開を停止します。
2. STUDIOの有料プランは、すぐに解約せず1か月残すことをおすすめします（問題があったときに戻せるようにするため）。

## STEP 5｜同じ日にやること
- [ ] **価格の切り替え**：LINKTIVITYに依頼して、公式の段階制料金（1名¥8,000／2名¥4,000／3名¥2,800／4名以上¥2,500）と、OTAの上乗せ価格を**新サイト公開と同じ日**に反映します。OTAが旧価格のままだと、1名の予約では公式の方が高くなり、サイトの「公式が最安」という表記が事実と合わなくなります。
- [ ] **計測**：GA4の測定ID（`G-` で始まる）か、GTMのコンテナID（`GTM-` で始まる）を私に共有してください。サイトに設定します。
- [ ] **GBPのリンク修正**：Googleビジネスプロフィールのウェブサイト欄が `ninjagotours.com/comic-lp` を指しています（旧サイトでもリンク切れ）。`https://ninjagotours.com/` に直します。

## STEP 6｜メールの到達率対策（任意・DNS変更のついでに推奨）
Google Workspaceの管理画面で、SPFとDKIMが未設定になっています。
- **SPF**：TXTレコード（ホスト名 `@`）に `v=spf1 include:_spf.google.com ~all` を追加します。
  - すでに `v=spf1` で始まるTXTレコードがある場合は、新しく追加せず、既存のレコードに統合します。SPFのレコードは1つしか置けないためです。
- **DKIM**：Google管理コンソールの「メールの認証」で「新しいレコードを生成」→ 表示された値をTXTレコード（ホスト名 `google._domainkey`）として追加 →「認証を開始」を押します。

---

## 困ったとき
- **サイトが表示されない**：DNSの反映待ちの可能性があります。24時間待っても直らない場合は、STEP 3で保存したスクリーンショットをもとにAレコードを元に戻せば、STUDIOのサイトに戻ります。
- **メールが届かなくなった**：MXレコードを誤って変更した可能性があります。保存したスクリーンショットの値に戻してください。
