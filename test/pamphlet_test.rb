# frozen_string_literal: true

require 'minitest/autorun'
require 'stringio'
require_relative '../lib/pamphlet'

class PamphletTest < Minitest::Test
  def test_page_order_preserves_existing_two_column_imposition
    order = Pamphlet.page_order(22, 2, 3)

    assert_equal 24, order.length
    assert_equal [21, 22, 23, 0, 1, 2, 3, 4, 5, 18, 19, 20], order.first(12)
    assert_equal [15, 16, 17, 6, 7, 8, 9, 10, 11, 12, 13, 14], order.last(12)
  end

  def test_three_column_order_is_sequential_and_pads_a_duplex_sheet
    assert_equal (0...24).to_a, Pamphlet.page_order(20, 3, 2)
    assert_equal (0...12).to_a, Pamphlet.page_order(1, 3, 2)
  end

  def test_four_column_order_places_two_columns_on_each_side_of_the_fold
    assert_equal [28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 24, 25, 26, 27,
                  20, 21, 22, 23, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
                 Pamphlet.page_order(32, 4, 2)
  end

  def test_landscape_changes_paper_dimensions_and_layout_estimates
    data = pdf_with_pages(7)
    portrait = Pamphlet.analyze(data)
    landscape = Pamphlet.analyze(data, orientation: 'landscape')
    refute_equal portrait[:candidates], landscape[:candidates]

    result = Pamphlet.build(data, columns: 3, rows: 2, orientation: 'landscape')
    output = HexaPDF::Document.new(io: StringIO.new(result[:pdf]))
    assert_operator output.pages[0].box.width, :>, output.pages[0].box.height
    assert_equal 2, result[:output_pages]
    assert_equal 5, result[:blank_slots]
  end

  def test_invalid_orientation_is_rejected
    assert_raises(Pamphlet::InputError) { Pamphlet.analyze(pdf_with_pages(1), orientation: 'sideways') }
    assert_raises(Pamphlet::InputError) do
      Pamphlet.build(pdf_with_pages(1), columns: 2, rows: 2, orientation: 'sideways')
    end
  end

  def test_analysis_recommends_fewer_sheets_when_landscape_slides_fit_equally
    result = Pamphlet.analyze(pdf_with_pages(22, width: 960, height: 540))

    assert_equal 22, result[:page_count]
    assert_equal({ columns: 2, rows: 3 }, result[:recommended])
    layout = result[:candidates].find { |item| item[:columns] == 2 && item[:rows] == 3 }
    assert_equal 2, layout[:sheets]
    assert_equal 2, layout[:blank_slots]
  end

  def test_analysis_recommends_larger_cells_for_portrait_documents
    result = Pamphlet.analyze(pdf_with_pages(22, width: 595, height: 842))

    assert_equal({ columns: 2, rows: 2 }, result[:recommended])
  end

  def test_build_returns_duplex_pages_and_blank_slot_count
    result = Pamphlet.build(pdf_with_pages(22), columns: 2, rows: 3)
    output = HexaPDF::Document.new(io: StringIO.new(result[:pdf]))

    assert_equal 4, output.pages.count
    assert_equal 2, result[:sheets]
    assert_equal 2, result[:blank_slots]
  end

  def test_build_supports_four_by_four_for_larger_documents
    result = Pamphlet.build(pdf_with_pages(33), columns: 4, rows: 4)
    output = HexaPDF::Document.new(io: StringIO.new(result[:pdf]))

    assert_equal 4, output.pages.count
    assert_equal 31, result[:blank_slots]
  end

  def test_layout_must_use_between_two_and_four_rows_and_columns
    assert_raises(Pamphlet::InputError) do
      Pamphlet.build(pdf_with_pages(1), columns: 1, rows: 3)
    end
  end

  private

  def pdf_with_pages(count, width: 612, height: 792)
    document = HexaPDF::Document.new
    count.times { document.pages.add([0, 0, width, height]) }
    io = StringIO.new(''.b)
    document.write(io)
    io.string
  end
end
