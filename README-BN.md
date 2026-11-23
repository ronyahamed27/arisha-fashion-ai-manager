# Aarisha Fashion AI Business Management System — V2

বাংলা Admin Dashboard + Node.js/Express + PostgreSQL + OpenAI Responses API + Meta Messenger Webhook + Steadfast Courier API।

## V2-তে অন্তর্ভুক্ত
- Admin login (JWT, 12 ঘণ্টা)
- Product CRUD, SKU, মূল্য, স্টক; অর্ডার তৈরি হলে স্টক কমে
- Order list ও status update
- Messenger webhook verification এবং OpenAI-ভিত্তিক বাংলা reply
- AI-কে পণ্যের বর্তমান মূল্য/স্টক দেওয়া
- Daily report endpoint এবং Asia/Dhaka timezone-এ দৈনিক সারাংশ লগ
- Steadfast booking API integration
- **Courier booking hard gate:** UI-তে confirmation dialog এবং API-তে `APPROVE_STEADFAST_BOOKING` confirmation string ছাড়া বুকিং endpoint কাজ করবে না। AI prompt-এও booking নিষিদ্ধ।

## চালু করার আগে আবশ্যক
এই ZIP হলো deploy-ready source code, কিন্তু আপনার নিজস্ব credentials ছাড়া Meta, OpenAI, PostgreSQL বা Steadfast-এ live সংযোগ করা সম্ভব নয়। নিচের environment variables Render-এ সেট করুন:
- `DATABASE_URL`
- `JWT_SECRET` (দীর্ঘ random secret)
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- `OPENAI_API_KEY`
- `META_VERIFY_TOKEN`, `META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`
- `STEADFAST_API_KEY`, `STEADFAST_SECRET_KEY`
- ঐচ্ছিক `OPENAI_MODEL`, `META_GRAPH_VERSION`, `TIMEZONE`

`ADMIN_PASSWORD` plain text রাখা যায় (প্রথম setup-এ), অথবা bcrypt hash দিতে পারেন। Production-এ শক্তিশালী password ব্যবহার করুন।

## Local run
1. Node.js 20+ এবং PostgreSQL ইনস্টল করুন।
2. `npm install`
3. `.env.example` কপি করে `.env` বানিয়ে values পূরণ করুন।
4. `npm start`
5. `http://localhost:3000` খুলুন।

## Render deploy
1. ZIP extract করে GitHub repository-তে ফাইলগুলো upload/push করুন।
2. Render-এ New → Web Service → repository নির্বাচন।
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Render PostgreSQL তৈরি করে Internal Database URL-টি `DATABASE_URL` হিসেবে দিন।
6. Environment variables পূরণ করে deploy করুন।
7. Meta Developer Console-এ Callback URL হবে `https://YOUR-SERVICE.onrender.com/webhook`; Verify Token হবে `META_VERIFY_TOKEN`; `messages` webhook subscription চালু করুন।

## Steadfast
API endpoint `POST /api/v1/create_order`; header `Api-Key` ও `Secret-Key`। লাইভে চালানোর আগে আপনার Steadfast merchant account-এর বর্তমান API docs-এ payload/response fields মিলিয়ে নিন। সফল booking response থেকে consignment id সংরক্ষণ হয়। বুকিং API credentials না থাকলে booking বন্ধ থাকবে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও নিরাপত্তা
- Meta Page token, OpenAI key, Steadfast keys কখনো browser বা GitHub-এ রাখবেন না; শুধু Render Environment Variables।
- Messenger AI কথোপকথন থেকে সরাসরি অর্ডার তৈরি করে না; Dashboard থেকে অর্ডার তৈরি করতে হয়। Customer checkout/order extraction-এর জন্য পরবর্তী integration প্রয়োজন।
- Daily report বর্তমানে API ও server log-এ তৈরি হয়; email/Messenger delivery বা PDF export নেই।
- Courier status sync/webhook, return/refund workflow, multiple product lines per UI order, image upload/storage, advanced roles/permissions ও audit log এখনো অন্তর্ভুক্ত নয়।
- Admin JWT secret বদলালে পুরনো token বাতিল হবে।
- Meta signature validation raw-body ভিত্তিক production-hardening-এর জন্য reverse proxy/body parser configuration যাচাই করুন; deploy-এর আগে test করুন।

## Health check
`GET /health` → service/version status.
