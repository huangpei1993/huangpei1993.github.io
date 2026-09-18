const { Component, Fragment } = require('inferno');
const { cacheComponent } = require('hexo-component-inferno/lib/util/cache');
const AdsenseX = require('./ads_x');

class Categories extends Component {
    // renderList 渲染默认分类列表，分类页仍沿用原有的静态展示方式。
    renderList(categories, showCount, count, isPage) {
        return categories.map(category => { return (count.n++ < 10 || isPage) ? <li>
            <a class="level is-mobile is-marginless" href={category.url}>
                <span class="level-start">
                    <span class="level-item">{category.name}</span>
                </span>
                {showCount ? <span class="level-end">
                    <span class="level-item tag">{category.count}</span>
                </span> : null}
            </a>
            {category.children.length ? <ul class="mr-0">{this.renderList(category.children, showCount, count, isPage)}</ul> : null}
        </li> : null });
    }

    // renderSidebarList 在右侧分类组件中展开文章标题，使用原生 details 保证鼠标和键盘均可操作。
    renderSidebarList(categories, showCount, count) {
        return categories.map(category => { return count.n++ < 10 ? <li class="sidebar-category-item">
            <details class="sidebar-category-disclosure">
                <summary class="level is-mobile is-marginless sidebar-category-summary">
                    <span class="level-start">
                        <span class="level-item">{category.name}</span>
                    </span>
                    <span class="level-end">
                        {showCount ? <span class="level-item tag">{category.count}</span> : null}
                        <span class="level-item"><i class="fas fa-chevron-down sidebar-category-caret" aria-hidden="true"></i></span>
                    </span>
                </summary>
                <ul class="sidebar-category-posts">
                    {category.posts.map(post => <li><a href={post.url}>{post.title}</a></li>)}
                    {category.count > category.posts.length ? <li class="sidebar-category-more"><a href={category.url}>查看该分类全部文章</a></li> : null}
                </ul>
            </details>
            {category.children.length ? <ul class="mr-0 sidebar-category-children">{this.renderSidebarList(category.children, showCount, count)}</ul> : null}
        </li> : null });
    }

    render() {
        const {
            title,
            showCount,
            categories,
            isPage,
            isExpandableSidebar,
            allUrl
        } = this.props;
        const count = { n: 0 };

        return <Fragment>
            {isPage ? <AdsenseX /> : null}
            <div class="card widget" data-type="categories">
                <div class="card-content">
                    <div class="menu">
                        <h3 class="menu-label">{title}</h3>
                        <ul class="menu-list">
                            {isExpandableSidebar ? this.renderSidebarList(categories, showCount, count) : this.renderList(categories, showCount, count, isPage)}
                            {count.n >= 10 && !isPage ? <li>
                                <a class="level is-mobile is-marginless" href={allUrl}>
                                    <span className="level-start">
                                        <span className="level-item">查看全部>></span>
                                    </span>
                                </a>
                            </li> : null
                            }
                        </ul>
                    </div>
                </div>
        </div>
        {isPage ? <AdsenseX /> : null}
        </Fragment>
    }
}

module.exports = Categories.Cacheable = cacheComponent(Categories, 'widget.categories', props => {
    // adapted from hexo/lib/plugins/helper/list_categories.js
    const {
        page,
        helper,
        categories = props.site.categories,
        orderBy = 'name',
        order = 1,
        show_current = false,
        show_count = true,
        isPage
    } = props;
    const { url_for, _p } = helper;

    if (!categories || !categories.length) {
        return null;
    }

    let depth = 0;
    try {
        depth = parseInt(props.depth, 10);
    } catch (e) { }

    function prepareQuery(parent) {
        const query = {};

        if (parent) {
            query.parent = parent;
        } else {
            query.parent = { $exists: false };
        }

        return categories.find(query).sort(orderBy, order).filter(cat => cat.length);
    }

    // getCollectionData 兼容不同 Hexo 版本中的 Warehouse 集合结构。
    function getCollectionData(collection) {
        if (!collection) {
            return [];
        }
        return Array.isArray(collection.data) ? collection.data : Array.from(collection);
    }

    // getCategoryOrder 使数值越小的文章优先展示，未设置排序值的文章保持在最后。
    function getCategoryOrder(post) {
        if (post.category_order === undefined || post.category_order === null || post.category_order === '') {
            return Number.MAX_SAFE_INTEGER;
        }
        const categoryOrder = Number(post.category_order);
        return Number.isFinite(categoryOrder) ? categoryOrder : Number.MAX_SAFE_INTEGER;
    }

    const widget = props.widget || {};
    const maxPosts = Math.max(1, Number(widget.max_posts) || 5);

    function hierarchicalList(level, parent) {
        return prepareQuery(parent).map((cat, i) => {
            let children = [];
            if (!depth || level + 1 < depth) {
                children = hierarchicalList(level + 1, cat._id);
            }

            let isCurrent = false;
            if (show_current && page) {
                for (let j = 0; j < cat.length; j++) {
                    const post = cat.posts.data[j];
                    if (post && post._id === page._id) {
                        isCurrent = true;
                        break;
                    }
                }
                // special case: category page
                isCurrent = isCurrent || (page.base && page.base.startsWith(cat.path));
            }

            return {
                children,
                isCurrent,
                name: cat.name,
                count: cat.length,
                url: url_for(cat.path),
                // 展开列表与分类归档页保持相同规则：category_order 升序，同值时按日期倒序。
                posts: getCollectionData(cat.posts)
                    .sort((a, b) => getCategoryOrder(a) - getCategoryOrder(b) || new Date(b.date) - new Date(a.date))
                    .slice(0, maxPosts)
                    .map(post => ({
                        title: post.title || '未命名文章',
                        url: url_for(post.path)
                    }))
            };
        });
    }

    return {
        showCount: show_count,
        categories: hierarchicalList(0),
        title: _p('common.category', Infinity),
        allUrl: url_for('/categories/'),
        isPage: isPage,
        // 仅右侧小组件提供文章展开，独立分类页维持完整的分类归档列表。
        isExpandableSidebar: !isPage && widget.position === 'right'
    };
});
