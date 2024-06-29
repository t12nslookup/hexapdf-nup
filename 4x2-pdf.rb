#!/usr/bin/env ruby
# frozen_string_literal: true

#
# Usage: 4x2-pdf.rb source.pdf dest.pdf
#
# Arranges the pages from source.pdf in a pattern where each +column_count+ pages
# are arranged from left to right. It is assumed that all pages are of the same
# size.
#
require 'hexapdf'
require 'byebug'

# Check if the required number of arguments is provided
if ARGV.length < 2
  puts 'Not enough arguments. Please use the following format:'
  puts "#{File.basename($0)} <input_filename> <output_filename>"
  exit(1)
end

src_path = ARGV[0]
target_path = ARGV[1]

target = HexaPDF::Document.new
src =  HexaPDF::Document.open(src_path)

page_width = 595 # :A4
page_height = 842 # :A4

columns = 2
rows = 4
pages_per_double = (columns * rows * 2)

# desired 237 x 220 (double margin in the middle x)
margin = 20
des_x = (page_width - (2 * margin) - ((columns - 1) * margin * 2)) / columns.to_f
des_y = (page_height - (2 * margin) - ((rows - 1) * margin)) / rows.to_f

# assuming all slides the same
slide_width = src.pages[0].box.width
slide_height = src.pages[0].box.height

scale_f = [des_y / slide_height, des_x / slide_width].min
new_width = (slide_width * scale_f).to_i
new_height = (slide_height * scale_f).to_i

before = (0...(src.pages.count / pages_per_double.to_f).ceil * pages_per_double).to_a
page_order = []

loop do
  page_order << before.pop(rows)
  page_order << before.shift(rows * 2)
  page_order << before.pop(rows)
  break if before.empty?
end

page_order.flatten!

page_order.each_slice(rows * 2) do |arr|
  i = 0

  canvas = target.pages.add(:A4, orientation: :portrait).canvas
  canvas.line_dash_pattern(10, 2)
  canvas.line(page_width / 2, margin * 4, page_width / 2, page_height - margin * 4).stroke
  columns.times do |x|
    rows.times do |y|
      pos = arr[i]
      page = src.pages[pos] unless pos.nil?

      unless page.nil?
        pos_x = (x * (des_x + margin * 2)) + margin
        pos_y = page_height - margin - new_height - (y * (des_y + margin))

        # print "Page: #{target.pages.count}, Col: #{x}, Row: #{y} Page: #{pos}"
        # print " at: [#{pos_x}, #{pos_y}], width: #{new_width}, height: #{new_height}\n"

        form = target.import(page.to_form_xobject)
        canvas.xobject(form, at: [pos_x.to_i, pos_y.to_i],
                             width: new_width,
                             height: new_height)
      end
      i += 1
    end
  end
end

print "Hooray! # #{target.pages.count} Pages.\nCreating \"#{target_path}\"\n"

target.write(target_path)
