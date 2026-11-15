# frozen_string_literal: true

require 'json'
require 'sinatra/base'
require_relative 'lib/pamphlet'

class PamphletApp < Sinatra::Base
  MAX_UPLOAD_BYTES = 50 * 1024 * 1024

  set :public_folder, File.expand_path('public', __dir__)
  set :show_exceptions, false
  set :raise_errors, false

  before do
    headers 'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'no-referrer'
  end

  get '/' do
    send_file File.join(settings.public_folder, 'index.html')
  end

  post '/api/analyze' do
    pdf_data = read_pdf_upload
    content_type :json
    JSON.generate(Pamphlet.analyze(pdf_data))
  rescue Pamphlet::InputError => e
    json_error(422, e.message)
  rescue HexaPDF::Error, ArgumentError
    json_error(422, 'This file could not be read as a valid PDF.')
  end

  post '/api/preview' do
    pdf_data = read_pdf_upload
    columns = Integer(params['columns'], 10)
    rows = Integer(params['rows'], 10)
    result = Pamphlet.build(pdf_data, columns: columns, rows: rows)

    headers 'Content-Type' => 'application/pdf',
            'X-Output-Pages' => result[:output_pages].to_s,
            'X-Paper-Sheets' => result[:sheets].to_s,
            'X-Blank-Slots' => result[:blank_slots].to_s
    body result[:pdf]
  rescue Pamphlet::InputError => e
    json_error(422, e.message)
  rescue HexaPDF::Error, ArgumentError
    json_error(422, 'This file or layout could not be processed.')
  end

  private

  def read_pdf_upload
    json_error(415, 'Upload a PDF file to continue.') unless request.media_type == 'application/pdf'
    json_error(413, 'PDF files must be 50 MB or smaller.') if request.content_length.to_i > MAX_UPLOAD_BYTES

    pdf_data = request.body.read(MAX_UPLOAD_BYTES + 1)
    json_error(413, 'PDF files must be 50 MB or smaller.') if pdf_data.bytesize > MAX_UPLOAD_BYTES
    json_error(400, 'Choose a PDF file to continue.') if pdf_data.empty?

    pdf_data
  end

  def json_error(status, message)
    content_type :json
    halt status, JSON.generate(error: message)
  end
end
