# frozen_string_literal: true

require 'cgi'
require 'json'

module Heyween
  # Keep the article browser and its search index tied to Jekyll's actual posts.
  # In particular, use Document#url rather than re-creating a slug from a title.
  class BlogCatalog < Jekyll::Generator
    safe true
    priority :low

    FEATURED_SUMMARIES = {
      '进程与并发' => '从进程状态、调度到同步互斥，梳理并发执行的基本问题。',
      '文件管理' => '沿着文件组织、目录与 inode，理解数据如何被存储、查找和保护。',
      '系统编程入门训练笔记' => '用 POSIX I/O、函数指针和 Make，串起进入内核实验前的基础训练。',
      'Self-attention' => '从序列上下文出发，拆解 Q、K、V 与多头自注意力的计算过程。',
      'CampusHub 后端架构设计笔记' => '以 CampusHub 为例，理解模块化单体、模块边界与事务中的业务协作。',
      '学术论文写作上手指南' => '从论证链到章节与图表，把研究问题组织成一篇可读的论文。'
    }.freeze

    CATEGORY_DETAILS = {
      '操作系统' => {
        'label' => '操作系统', 'icon' => 'system',
        'description' => '从进程到文件，理解系统如何运转'
      },
      '软件工程与计算ⅠⅠ' => {
        'label' => '软件工程', 'icon' => 'code',
        'description' => '让设计落到清楚的模块与代码'
      },
      '机器学习' => {
        'label' => '机器学习', 'icon' => 'brain',
        'description' => '从直觉出发，推到模型与实现'
      },
      '科研' => {
        'label' => '科研', 'icon' => 'research',
        'description' => '记录阅读、写作与研究中的思考'
      }
    }.freeze

    def generate(site)
      baseurl = site.config['baseurl'].to_s.sub(%r{/+\z}, '')
      documents = site.posts.docs.reject do |post|
        post.data['hidden'] == true || post.data['hidden'] == 'true' || post.data['published'] == false
      end.sort_by { |post| [post.date.to_f, post.path] }.reverse

      posts = documents.map do |post|
        title = post.data['title'].to_s
        categories = Array(post.data['categories']).map(&:to_s)
        summary = summary_for(post)
        post.data['catalog_summary'] = summary

        {
          'title' => title,
          'url' => "#{baseurl}#{post.url}",
          'date' => post.date.strftime('%Y-%m-%d'),
          'category' => categories.first.to_s,
          'categories' => categories,
          'summary' => summary,
          'search_text' => plain_text(post.content, keep_code: true)
        }
      end

      counts = Hash.new(0)
      posts.each { |post| post['categories'].uniq.each { |name| counts[name] += 1 } }
      primary = CATEGORY_DETAILS.keys.select { |name| counts.key?(name) }
      remaining = counts.keys.reject { |name| primary.include?(name) }.sort_by { |name| [-counts[name], name] }
      categories = (primary + remaining).map do |name|
        # Preserve the original category as its identifier: the two software
        # engineering courses have distinct Roman numerals but colliding slugs.
        details = CATEGORY_DETAILS.fetch(name, { 'label' => name, 'icon' => 'book' })
        { 'name' => name, 'count' => counts[name] }.merge(details)
      end

      catalog = { 'posts' => posts, 'categories' => categories, 'total' => posts.length }
      site.data['blog_catalog'] = catalog

      index = Jekyll::PageWithoutAFile.new(site, site.source, 'assets/data', 'posts.json')
      index.data['layout'] = nil
      index.data['sitemap'] = false
      index.data['render_with_liquid'] = false
      index.content = JSON.generate(catalog)
      site.pages << index

      generate_category_pages(site, documents, categories)
      generate_legacy_home_pages(site)
    end

    private

    def generate_legacy_home_pages(site)
      # These were the ten published article-list pages before Home became
      # a category index. Keep their addresses without duplicating Home.
      (2..11).each do |number|
        path = "page#{number}"
        next if site.pages.any? { |page| page.url.sub(%r{/+\z}, '') == "/#{path}" }

        page = Jekyll::PageWithoutAFile.new(site, site.source, path, 'index.html')
        page.data['layout'] = 'catalog-redirect'
        page.data['redirect_to'] = '/articles/'
        page.data['sitemap'] = false
        site.pages << page
      end
    end

    def generate_category_pages(site, documents, categories)
      slug_mode = site.config.dig('jekyll-archives', 'slug_mode')
      groups = categories.group_by do |category|
        Jekyll::Utils.slugify(category['name'], mode: slug_mode)
      end

      groups.each do |slug, members|
        names = members.map { |category| category['name'] }
        posts = documents.select do |post|
          (Array(post.data['categories']).map(&:to_s) & names).any?
        end

        # Keep previously published category URLs working. If two original
        # names share a Jekyll slug, one compatible page contains both sets
        # rather than whichever archive happened to overwrite the other.
        page = Jekyll::PageWithoutAFile.new(site, site.source, File.join('categories', slug), 'index.html')
        page.data['layout'] = 'category'
        page.data['title'] = names.join(' · ')
        page.data['category_names'] = names
        page.data['posts'] = posts
        site.pages << page
      end
    end

    def summary_for(post)
      description = post.data['description'].to_s.strip
      return plain_text(description) unless description.empty?
      return FEATURED_SUMMARIES[post.data['title']] if FEATURED_SUMMARIES.key?(post.data['title'])

      text = plain_text(summary_source(post.content))
      return post.data['title'].to_s if text.empty?
      return text if text.length <= 110

      "#{text[0, 110].rstrip}…"
    end

    def summary_source(content)
      # Reading instructions and code-file inventories are useful in a note,
      # but the preview should start with its actual subject matter.
      source = content.gsub(/^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1[^\n]*$/m, ' ')
      skipped_level = nil
      source.lines.reject do |line|
        heading = line.match(/^\s*(\#{1,6})\s+(.+)$/)
        if heading
          level = heading[1].length
          skipped_level = nil if skipped_level && level <= skipped_level
          skipped_level = level if heading[2].match?(/阅读指南|阅读建议|知识依赖链/)
        end
        skipped_level || heading || line.match?(/^\s*>?\s*\*\*(?:阅读指南|对应代码|对应测试|训练脚本|参考|前置知识)\*\*/)
      end.join
    end

    def plain_text(content, keep_code: false)
      text = content.to_s.dup
      text.gsub!(/<!--.*?-->/m, ' ')
      text.gsub!(/<(script|style)\b[^>]*>.*?<\/\1>/im, ' ')
      text.gsub!(/\{%.*?%\}|\{\{.*?\}\}/m, ' ')
      if keep_code
        text.gsub!(/^\s*(`{3,}|~{3,})[^\n]*$/, ' ')
      else
        text.gsub!(/^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1[^\n]*$/m, ' ')
      end
      text.gsub!(/\$\$.*?\$\$|\\\[.*?\\\]/m, ' ')
      text.gsub!(/!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]/, ' ')
      text.gsub!(/\[([^\]]+)\]\([^)]*\)|\[([^\]]+)\]\[[^\]]*\]/) { Regexp.last_match(1) || Regexp.last_match(2) }
      text.gsub!(/<[^>]+>/m, ' ')
      text.gsub!(/\$[^$\n]+\$/, ' ')
      text.gsub!(/^\s*\|.*$/, ' ')
      text.gsub!(/^\s*\[[^\]]+\]:.*$/, ' ')
      text.gsub!(/^\s*(?:\#{1,6}|>|[-*+]\s|\d+[.)]\s)\s*/, '')
      text.gsub!(/^\s*[-=_*]{3,}\s*$/, ' ')
      text.gsub!(/[`*~]/, '')
      text.gsub!(/(?<!\w)_([^_]+)_(?!\w)/, '\1')
      CGI.unescapeHTML(text).gsub(/\s+/, ' ').strip
    end
  end
end
