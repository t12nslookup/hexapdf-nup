# frozen_string_literal: true

require 'minitest/autorun'
require 'rack/mock'
require 'stringio'
ENV['RAILWAY_PUBLIC_DOMAIN'] ||= 'foldform.up.railway.app'
require_relative '../app'

class PamphletAppTest < Minitest::Test
  def test_analyze_endpoint_accepts_pdf_bytes_in_memory
    response = request('POST', '/api/analyze', pdf_with_pages(2))

    assert_equal 200, response.status
    assert_equal 2, JSON.parse(response.body)['page_count']
    assert_equal 'no-store', response.headers['Cache-Control']
  end

  def test_homepage_accepts_railway_public_domain
    response = request('GET', '/', '', host: ENV.fetch('RAILWAY_PUBLIC_DOMAIN'))

    assert_equal 200, response.status
    assert_includes response.body, 'Make a long'
  end

  def test_analyze_endpoint_rejects_non_pdf_uploads
    response = request('POST', '/api/analyze', 'not a pdf')

    assert_equal 422, response.status
    assert_equal 'The upload does not look like a PDF.', JSON.parse(response.body)['error']
  end

  def test_preview_endpoint_rejects_invalid_layouts
    response = request('POST', '/api/preview?columns=1&rows=3', pdf_with_pages(1))

    assert_equal 422, response.status
    assert_match(/layout/, JSON.parse(response.body)['error'])
  end

  def test_preview_endpoint_returns_a_pdf
    response = request('POST', '/api/preview?columns=2&rows=3', pdf_with_pages(7))
    output = HexaPDF::Document.new(io: StringIO.new(response.body))

    assert_equal 200, response.status
    assert_equal 'application/pdf', response.headers['Content-Type']
    assert_equal 2, output.pages.count
    assert_equal '1', response.headers['X-Paper-Sheets']
    assert_equal '5', response.headers['X-Blank-Slots']
  end

  def test_endpoints_accept_and_validate_orientation
    data = pdf_with_pages(7)
    response = request('POST', '/api/preview?columns=3&rows=2&orientation=landscape', data)
    assert_equal 200, response.status
    output = HexaPDF::Document.new(io: StringIO.new(response.body))
    assert_operator output.pages[0].box.width, :>, output.pages[0].box.height

    %w[/api/analyze?orientation=sideways /api/preview?columns=2&rows=2&orientation=sideways].each do |path|
      invalid = request('POST', path, data)
      assert_equal 422, invalid.status
      assert_match(/orientation/, JSON.parse(invalid.body)['error'])
    end
  end

  private

  def request(method, path, body, host: 'localhost')
    env = Rack::MockRequest.env_for(
      path,
      method: method,
      'CONTENT_TYPE' => 'application/pdf',
      'HTTP_HOST' => host,
      input: body
    )
    status, headers, response_body = PamphletApp.call(env)
    body = +''.b
    response_body.each { |chunk| body << chunk }
    Struct.new(:status, :headers, :body).new(status, headers, body)
  end

  def pdf_with_pages(count)
    document = HexaPDF::Document.new
    count.times { document.pages.add(:A4) }
    io = StringIO.new(''.b)
    document.write(io)
    io.string
  end
end
