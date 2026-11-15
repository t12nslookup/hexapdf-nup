# Foldform

Foldform arranges a PDF's pages onto A4 sheets for double-sided printing. The
web interface lets you compare 2–4 column and row layouts, preview the imposed
PDF, and download it.

## Run locally

Requires Ruby 3.2 or newer.

```sh
bundle install
bundle exec puma -p 3000 config.ru
```

Open <http://localhost:3000>. Run the test suite with:

```sh
bundle exec ruby -Itest test/pamphlet_test.rb
bundle exec ruby -Itest test/app_test.rb
```

## Deploy to Railway

Create a Railway project from this GitHub repository. Railway installs the
gems from `Gemfile` and starts the web process using `Procfile`; it listens on
Railway's assigned `PORT`.

## PDF handling

PDFs are sent as raw request bodies (not multipart uploads), read and
processed in memory, and never written to disk or retained between requests.
The browser sends the selected PDF again when generating a preview. The app
does not use a database. Uploads are limited to 50 MB and 500 pages per PDF.
The preview uses the browser's built-in PDF viewer.

The recommendation favors the fewest sheets among layouts that preserve at
least 85% of the largest printed-page size. Page-size estimates use the first
page; every page is scaled to fit its own cell when the output is generated.
