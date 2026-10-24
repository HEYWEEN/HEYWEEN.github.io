# frozen_string_literal: true

module Heyween
  module BlogThemeAssets
    module_function

    def retired?(item, theme_root)
      # Page#path is relative; the reader's base identifies the actual source.
      # Check both origin and path so local replacements remain untouched.
      base = item.instance_variable_get(:@base)
      return false unless base && File.expand_path(base) == theme_root

      path = item.relative_path.to_s.delete_prefix('/')
      path == 'assets/404.html' || path.start_with?('assets/js/dist/')
    end
  end
end

# Jekyll reads a theme's assets independently of _config.yml's exclude list.
# Remove the retired UI bundles after reading, before generators and writing.
Jekyll::Hooks.register :site, :post_read do |site|
  next unless site.theme

  theme_root = File.expand_path(site.theme.root)
  site.pages.reject! { |page| Heyween::BlogThemeAssets.retired?(page, theme_root) }
  site.static_files.reject! { |file| Heyween::BlogThemeAssets.retired?(file, theme_root) }
end
