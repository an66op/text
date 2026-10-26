export default function EventPagination({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return total > 20 || page > 0 ? (
    <nav className="sce-pagination" aria-label="活动分页">
      <button type="button" disabled={loading || page === 0} onClick={() => onPage(page - 1)}>
        上一页
      </button>
      <span>
        第 {page + 1} 页 · 共 {total} 项
      </span>
      <button
        type="button"
        disabled={loading || (page + 1) * 20 >= total}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </nav>
  ) : null;
}
