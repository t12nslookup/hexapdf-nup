# frozen_string_literal: true

require 'hexapdf'
require 'stringio'

module Pamphlet
  class InputError < StandardError; end

  PAPER_WIDTH = 595.28
  PAPER_HEIGHT = 841.89
  MARGIN = 20
  MAX_PAGES = 500
  LAYOUTS = (2..4).flat_map do |columns|
    (2..4).map { |rows| { columns: columns, rows: rows } }
  end.freeze
  RECOMMENDATION_SCALE_TOLERANCE = 0.85

  module_function

  def analyze(pdf_data)
    source = open_document(pdf_data)
    page_count = source.pages.count
    validate_page_count!(page_count)

    first_page = source.pages[0]
    page_width, page_height = page_dimensions(first_page)
    candidates = LAYOUTS.map do |layout|
      candidate(layout[:columns], layout[:rows], page_count, page_width, page_height)
    end
    recommendation = recommend(candidates)

    {
      page_count: page_count,
      page_width_mm: points_to_mm(page_width).round(1),
      page_height_mm: points_to_mm(page_height).round(1),
      candidates: candidates,
      recommended: recommendation.slice(:columns, :rows)
    }
  end

  def build(pdf_data, columns:, rows:)
    validate_layout!(columns, rows)

    source = open_document(pdf_data)
    page_count = source.pages.count
    validate_page_count!(page_count)
    output = HexaPDF::Document.new

    page_order(page_count, columns, rows).each_slice(columns * rows) do |page_indexes|
      canvas = output.pages.add(:A4, orientation: :portrait).canvas
      draw_column_guides(canvas, columns, rows)

      columns.times do |column|
        rows.times do |row|
          source_index = page_indexes[column * rows + row]
          next if source_index >= page_count

          source_page = source.pages[source_index]
          cell_width, cell_height = cell_size(columns, rows)
          source_width, source_height = page_dimensions(source_page)
          scale = [cell_width / source_width, cell_height / source_height].min
          page_width = source_width * scale
          page_height = source_height * scale
          x = MARGIN + column * (cell_width + 2 * MARGIN) + (cell_width - page_width) / 2
          y = PAPER_HEIGHT - MARGIN - cell_height - row * (cell_height + MARGIN) +
              (cell_height - page_height) / 2

          form = output.import(source_page.to_form_xobject)
          canvas.xobject(form, at: [x, y], width: page_width, height: page_height)
        end
      end
    end

    output_io = StringIO.new(''.b)
    output.write(output_io)
    sheets = (page_count.to_f / (columns * rows * 2)).ceil

    {
      pdf: output_io.string,
      output_pages: sheets * 2,
      sheets: sheets,
      blank_slots: sheets * columns * rows * 2 - page_count
    }
  end

  def page_order(page_count, columns, rows)
    pages_per_sheet = columns * rows * 2
    padded_pages = (page_count.to_f / pages_per_sheet).ceil * pages_per_sheet
    remaining = (0...padded_pages).to_a
    ordered = []

    until remaining.empty?
      ordered.concat(remaining.pop(rows))
      ordered.concat(remaining.shift(rows * columns))
      ordered.concat(remaining.pop(rows * (columns - 1)))
    end

    ordered
  end

  def candidate(columns, rows, page_count, page_width, page_height)
    width, height = cell_size(columns, rows)
    scale = [width / page_width, height / page_height].min
    capacity = columns * rows * 2
    sheets = (page_count.to_f / capacity).ceil

    {
      columns: columns,
      rows: rows,
      sheets: sheets,
      output_pages: sheets * 2,
      blank_slots: sheets * capacity - page_count,
      image_width_mm: (points_to_mm(page_width * scale)).round(1),
      image_height_mm: (points_to_mm(page_height * scale)).round(1),
      scale: scale
    }
  end
  private_class_method :candidate

  def recommend(candidates)
    largest_scale = candidates.map { |item| item[:scale] }.max
    eligible = candidates.select do |item|
      item[:scale] >= largest_scale * RECOMMENDATION_SCALE_TOLERANCE
    end

    eligible.min_by do |item|
      [item[:sheets], -item[:scale], item[:columns] * item[:rows]]
    end
  end
  private_class_method :recommend

  def cell_size(columns, rows)
    [
      (PAPER_WIDTH - 2 * MARGIN - (columns - 1) * 2 * MARGIN) / columns.to_f,
      (PAPER_HEIGHT - 2 * MARGIN - (rows - 1) * MARGIN) / rows.to_f
    ]
  end
  private_class_method :cell_size

  def draw_column_guides(canvas, columns, rows)
    return if columns < 2

    cell_width, = cell_size(columns, rows)
    canvas.line_dash_pattern(10, 2)
    (1...columns).each do |column|
      x = MARGIN + column * cell_width + (2 * column - 1) * MARGIN
      canvas.line(x, MARGIN * 4, x, PAPER_HEIGHT - MARGIN * 4).stroke
    end
  end
  private_class_method :draw_column_guides

  def open_document(pdf_data)
    unless pdf_data.byteslice(0, 1024)&.include?('%PDF-')
      raise InputError, 'The upload does not look like a PDF.'
    end

    HexaPDF::Document.new(io: StringIO.new(pdf_data))
  end
  private_class_method :open_document

  def validate_page_count!(page_count)
    raise InputError, 'The PDF has no pages.' if page_count.zero?
    raise InputError, "PDFs are limited to #{MAX_PAGES} pages." if page_count > MAX_PAGES
  end
  private_class_method :validate_page_count!

  def page_dimensions(page)
    width = page.box.width.to_f
    height = page.box.height.to_f
    unless width.positive? && height.positive? && width.finite? && height.finite?
      raise InputError, 'Every PDF page must have a valid page size.'
    end

    [width, height]
  end
  private_class_method :page_dimensions

  def validate_layout!(columns, rows)
    valid_columns = (2..4).cover?(columns)
    valid_rows = (2..4).cover?(rows)
    raise InputError, 'Select a layout with 2 to 4 columns and 2 to 4 rows.' unless valid_columns && valid_rows
  end
  private_class_method :validate_layout!

  def points_to_mm(points)
    points * 25.4 / 72
  end
  private_class_method :points_to_mm
end
