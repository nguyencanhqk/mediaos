/**
 * i18n (vi) — namespace "tasks", module TASK (Project) — S4-FE-TASK-1 (SPEC-06 §13.1/§13.2/§13.3/§13.4).
 */
export default {
  // S5-TASK-NAV-TREE-1 (đợt B) — cây phòng ban + dự án trong sidebar TASK (TaskSidebarTree.tsx)
  sidebarTree: {
    title: "Dự án theo phòng ban",
    loading: "Đang tải cây phòng ban",
    error: "Không tải được cây phòng ban.",
    empty: "Chưa có phòng ban hay dự án nào.",
    unassigned: "Chưa phân phòng ban",
    truncated: "Chỉ hiển thị {{count}} dự án đầu — mở Dự án để xem đầy đủ.",
    menuLabel: "Thao tác phòng ban {{name}}",
    collapse: "Thu gọn {{name}}",
    expand: "Mở rộng {{name}}",
    menu: {
      report: "Xem báo cáo",
      addProject: "Thêm dự án",
      sort: "Sắp xếp dự án",
    },
    sort: {
      newest: "Mới nhất trước",
      nameAsc: "Tên A→Z",
    },
    // S5-TASK-PROJROLE-1 (đợt C) — menu ⋯ NODE DỰ ÁN (KHÁC menu phòng ban ở trên): đúng 1 mục.
    projectMenuLabel: "Thao tác dự án {{name}}",
    projectMenu: {
      permissionSettings: "Cài đặt quyền",
    },
  },
  projects: {
    list: {
      title: "Dự án",
      description: "Danh sách dự án theo quyền và phạm vi dữ liệu của bạn.",
      addButton: "Tạo dự án",
      searchPlaceholder: "Tìm theo mã hoặc tên dự án",
      allStatuses: "Tất cả trạng thái",
      // S5-TASK-NAV-TREE-1 — filter phòng ban (?departmentId, deep-link từ cây sidebar)
      departmentFilterLabel: "Lọc theo phòng ban",
      allDepartments: "Tất cả phòng ban",
      filteredDepartment: "Phòng ban đang lọc",
      columns: {
        code: "Mã dự án",
        name: "Tên dự án",
        owner: "Owner",
        department: "Phòng ban",
        members: "Thành viên",
        priority: "Ưu tiên",
        startDate: "Ngày bắt đầu",
        endDate: "Deadline",
        status: "Trạng thái",
        actions: "Hành động",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem danh sách dự án.",
      },
      error: {
        title: "Không thể tải danh sách dự án",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      empty: {
        title: "Chưa có dự án nào",
        description: "Tạo dự án đầu tiên để bắt đầu quản lý công việc.",
      },
      loadMore: "Tải thêm",
    },
    detail: {
      backToList: "Quay lại danh sách",
      // S5-TASK-WORKSPACE-1 — tab bar vỏ workspace (SPEC-06 §13.3): kanban đổi nhãn thành "Bảng",
      // thêm Danh sách · Báo cáo · Hoạt động. Gantt/Lịch/Tài liệu/Biểu mẫu thuộc đợt D2-D5.
      tabs: {
        overview: "Tổng quan",
        board: "Bảng",
        list: "Danh sách",
        report: "Báo cáo",
        activity: "Hoạt động",
        members: "Thành viên",
      },
      fields: {
        code: "Mã dự án",
        description: "Mô tả",
        owner: "Owner",
        department: "Phòng ban",
        status: "Trạng thái",
        priority: "Ưu tiên",
        startDate: "Ngày bắt đầu",
        endDate: "Deadline",
        memberCount: "Thành viên",
        createdAt: "Ngày tạo",
        closedAt: "Ngày đóng",
      },
      // S5-TASK-WORKSPACE-1: bỏ key viewReport — nút header thay bằng tab "Báo cáo".
      actions: {
        edit: "Sửa dự án",
        close: "Đóng dự án",
        delete: "Xóa dự án",
      },
      closeDialog: {
        title: "Đóng dự án",
        description: "Dự án sẽ chuyển sang trạng thái Completed. Bạn có chắc chắn?",
        noteLabel: "Ghi chú (tuỳ chọn)",
        confirm: "Xác nhận đóng",
        cancel: "Hủy",
      },
      deleteDialog: {
        title: "Xóa dự án",
        description: 'Dự án "{{name}}" sẽ bị xóa mềm. Bạn có chắc chắn?',
        confirm: "Xác nhận xóa",
        cancel: "Hủy",
      },
      notFound: {
        title: "Không tìm thấy dự án",
        description: "Dự án không tồn tại hoặc bạn không có quyền xem.",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem dự án này.",
      },
      error: {
        title: "Không thể tải dự án",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      // S4-FE-TASK-4 — ProjectProgressCard (SPEC-06 §16.1, GET /projects/:id/report, view-report:project
      // SENSITIVE). KHÁC ProjectProgressWidget (S4-FE-DASH-2) — thêm overdueCount + workload theo người
      // phụ trách, chỉ manager/hr/admin thấy.
      report: {
        title: "Báo cáo dự án",
        overdueCount: "{{count}} quá hạn",
        workloadTitle: "Tải công việc theo người phụ trách",
        workloadEmpty: "Chưa có công việc đang hoạt động nào được giao.",
        activeCount: "{{count}} việc đang làm",
        unknownEmployee: "Không xác định",
        empty: {
          title: "Chưa có công việc nào",
          description: "Dự án này chưa có công việc để báo cáo.",
        },
        error: {
          title: "Không thể tải báo cáo dự án",
          description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
        },
      },
    },
    // S5-FE-TASK-6 — ProjectReportPage (TASK-SCREEN-011), TRANG mở rộng từ ProjectProgressCard. Dùng lại
    // các key `projects.detail.report.*` (error/empty/workload/activeCount/unknownEmployee); phần riêng
    // của trang (KPI tiles + tiêu đề + forbidden) đặt ở đây.
    report: {
      page: {
        backToDetail: "Quay lại dự án",
        fallbackTitle: "Báo cáo tiến độ dự án",
        subtitle: "Tổng hợp tiến độ, khối lượng công việc và số quá hạn của dự án.",
        breakdownTitle: "Phân bổ theo trạng thái",
        kpi: {
          total: "Tổng công việc",
          done: "Hoàn thành",
          notDone: "Chưa hoàn thành",
          overdue: "Quá hạn",
        },
        // S5-TASK-SUBTASK-1 (D-34/D-37/D-40) — ghi chú BẮT BUỘC: con số ở đây đếm theo LÁ (công việc
        // có việc con thì đếm việc con, không đếm việc cha) nên có thể khác danh sách "Việc của tôi"/
        // "Việc quá hạn"; người chỉ ôm việc cha (mọi con giao người khác) có thể hiện 0 việc đang làm.
        leafCountingNote:
          "Công việc có việc con được tính theo việc con (không tính việc cha) — số ở đây có thể khác danh sách công việc, và người chỉ phụ trách việc cha có thể hiện 0 việc đang làm trong biểu đồ tải bên dưới.",
        forbidden: {
          title: "Không có quyền truy cập",
          description: "Bạn không có quyền xem báo cáo tiến độ của dự án này.",
        },
      },
    },
    form: {
      createTitle: "Tạo dự án",
      editTitle: "Sửa dự án",
      fields: {
        name: "Tên dự án",
        code: "Mã dự án",
        description: "Mô tả",
        owner: "Owner",
        department: "Phòng ban",
        priority: "Ưu tiên",
        startDate: "Ngày bắt đầu",
        endDate: "Deadline",
      },
      placeholders: {
        none: "— Không chọn —",
        ownerHint: "Bạn sẽ tự động là Owner nếu bỏ trống",
      },
      errors: {
        nameRequired: "Tên dự án là bắt buộc",
        endBeforeStart: "Deadline không được nhỏ hơn ngày bắt đầu",
        conflict: "Mã hoặc tên dự án đã tồn tại trong công ty.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
      },
      cancel: "Hủy",
      save: "Lưu",
      create: "Tạo",
      saving: "Đang lưu…",
    },
    members: {
      title: "Thành viên dự án",
      addButton: "Thêm thành viên",
      columns: {
        employee: "Nhân viên",
        code: "Mã nhân viên",
        department: "Phòng ban",
        role: "Vai trò",
        joinedAt: "Ngày tham gia",
        status: "Trạng thái",
        actions: "Hành động",
      },
      role: {
        Owner: "Owner",
        Manager: "Manager",
        Member: "Member",
        Viewer: "Viewer",
      },
      memberStatus: {
        Active: "Đang hoạt động",
        Inactive: "Không hoạt động",
        Removed: "Đã xóa",
      },
      empty: {
        title: "Chưa có thành viên",
        description: "Thêm thành viên để cùng thực hiện dự án.",
      },
      error: {
        title: "Không thể tải thành viên",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      addDialog: {
        title: "Thêm thành viên",
        employeeLabel: "Nhân viên",
        employeePlaceholder: "— Chọn nhân viên —",
        roleLabel: "Vai trò",
        confirm: "Thêm",
        cancel: "Hủy",
      },
      removeDialog: {
        title: "Xóa thành viên",
        description: 'Xóa "{{name}}" khỏi dự án?',
        confirm: "Xác nhận xóa",
        cancel: "Hủy",
      },
      removeAction: "Xóa khỏi dự án",
      // S5-TASK-PROJROLE-1 (đợt C, DECISIONS-04 D-24) — khối chú giải TĨNH tab "Thành viên", mô tả
      // 4 vai trò. Chỉ text mô tả — KHÔNG logic quyền client (ProjectRoleLegend.tsx).
      roleLegend: {
        title: "Vai trò trong dự án",
        description: "Mô tả quyền hạn của từng vai trò trong phạm vi dự án này.",
        columns: {
          action: "Hành động",
          viewer: "Viewer",
          member: "Member",
          manager: "Manager",
          owner: "Owner",
        },
        rows: {
          view: "Xem dự án · công việc · bảng · thành viên · bình luận · tệp · checklist",
          watch: "Theo dõi (tự watch)",
          collab: "Viết bình luận · tick checklist · tải tệp công việc",
          editOwnTask: "Sửa công việc được giao cho mình",
          editOthersTask: "Sửa · di chuyển · giao · đổi ưu tiên/deadline công việc người khác",
          createTask: "Tạo công việc trong dự án",
          manageColumns: "Quản lý cột quy trình (pipeline)",
          editProject: "Sửa thông tin dự án",
          governance: "Quản lý thành viên · đổi chủ · đóng/lưu trữ/xóa dự án",
        },
        mark: {
          yes: "Có",
          no: "Không",
          assignee: "Nếu được giao",
        },
      },
    },
    status: {
      Planning: "Đang lên kế hoạch",
      Active: "Đang thực hiện",
      "On Hold": "Tạm dừng",
      Completed: "Hoàn thành",
      Cancelled: "Đã hủy",
      Archived: "Lưu trữ",
    },
    priority: {
      Low: "Thấp",
      Medium: "Trung bình",
      High: "Cao",
      Urgent: "Khẩn cấp",
    },
  },
  // S4-FE-TASK-2 — Task core (SPEC-06 §7/§9/§13.5-13.9/§14): TaskListPage · MyTasksPage · TaskDetailPage ·
  // TaskFormDrawer · TaskAssignControl · TaskStatusSelect. KHÁC `projects` ở trên (dự án — S4-FE-TASK-1).
  tasks: {
    list: {
      title: "Công việc",
      description: "Danh sách công việc theo quyền và phạm vi dữ liệu của bạn.",
      addButton: "Tạo công việc",
      allStatuses: "Tất cả trạng thái",
      allPriorities: "Tất cả mức ưu tiên",
      filters: {
        status: "Trạng thái",
        priority: "Độ ưu tiên",
        assignee: "Người phụ trách",
        project: "Dự án",
        allAssignees: "Tất cả người phụ trách",
        allProjects: "Tất cả dự án",
        dueFrom: "Hạn từ",
        dueTo: "Hạn đến",
        overdue: "Chỉ hiện quá hạn",
      },
      columns: {
        title: "Tiêu đề",
        project: "Dự án",
        assignee: "Người phụ trách",
        priority: "Ưu tiên",
        status: "Trạng thái",
        dueAt: "Deadline",
        creator: "Người tạo",
        actions: "Hành động",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem danh sách công việc.",
      },
      error: {
        title: "Không thể tải danh sách công việc",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      empty: {
        title: "Chưa có công việc nào",
        description: "Tạo công việc đầu tiên để bắt đầu quản lý công việc.",
      },
    },
    // S5-FE-TASK-6 — OverdueTasksPage (TASK-SCREEN-010). Tái dùng cột đọc + forbidden của `list`.
    overdue: {
      title: "Task quá hạn",
      description: "Danh sách công việc đã quá hạn, sắp xếp theo hạn gần nhất.",
      count: "{{display}} công việc quá hạn",
      error: {
        title: "Không thể tải danh sách task quá hạn",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      empty: {
        title: "Không có công việc quá hạn",
        description: "Tất cả công việc trong phạm vi của bạn đều đang đúng hạn.",
      },
    },
    my: {
      title: "Việc của tôi",
      description: "Công việc được giao cho bạn, do bạn tạo hoặc bạn đang theo dõi.",
      noProject: "Không thuộc dự án",
      groups: {
        assigned: "Được giao",
        created: "Tôi tạo",
        watched: "Đang theo dõi",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem việc của tôi.",
      },
      error: {
        title: "Không thể tải công việc",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      empty: {
        title: "Không có công việc",
        description: "Bạn chưa có công việc nào trong mục này.",
      },
    },
    // S5-TASK-MOVEPROJ-1 — đổi dự án của công việc (bắt buộc chọn cột đích để state_id không mồ côi).
    moveProject: {
      openAction: "Đổi dự án",
      title: "Đổi dự án của công việc",
      description: "Chọn dự án mới và cột sẽ đặt công việc vào trên bảng của dự án đó.",
      projectLabel: "Dự án",
      pickProject: "— Chọn dự án —",
      columnLabel: "Cột trên bảng",
      pickColumn: "— Chọn cột —",
      noColumns:
        "Dự án này chưa có cột pipeline nên chưa nhận công việc được. Hãy thêm cột cho dự án đó trước, rồi quay lại đổi.",
      columnsError: "Không tải được danh sách cột. Thử lại trước khi đổi dự án.",
      columnRequiredHint: "Phải chọn cột đích, nếu không thẻ sẽ nằm sai cột trên bảng mới.",
      lockedChild:
        "Đây là việc con — việc con luôn thuộc dự án của công việc cha, không đổi riêng được.",
      lockedParent:
        "Công việc này đang có việc con. Cả cây phải cùng một dự án — gỡ hoặc xóa việc con trước khi đổi.",
      confirm: "Chuyển dự án",
      cancel: "Hủy",
      saving: "Đang chuyển…",
      errors: {
        badRequest: "Không chuyển được — kiểm tra cột đích, hoặc công việc đang có việc con.",
        forbidden: "Bạn không có quyền chuyển công việc sang dự án khác.",
        notFound: "Không tìm thấy công việc hoặc dự án đích.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Không chuyển được dự án. Vui lòng thử lại.",
      },
    },
    // S5-TASK-LAYOUT-1 — bộ chọn người dùng chung (ô người phụ trách + dòng việc con).
    picker: {
      title: "Chọn người",
      change: "Đổi người (hiện tại: {{name}})",
      searchPlaceholder: "Tìm thành viên…",
      clear: "— Bỏ chọn người —",
      noMatch: "Không tìm thấy ai phù hợp.",
    },
    detail: {
      backToList: "Quay lại danh sách",
      // S5-TASK-LAYOUT-1 — gom 5 khối rời thành 2 nhóm tab cho đỡ phải cuộn.
      tabs: {
        subtasks: "Việc con",
        checklist: "Checklist",
        comments: "Bình luận",
        files: "Tệp đính kèm",
        activity: "Hoạt động",
      },
      // S5-TASK-LAYOUT-1 — mô tả sửa tại chỗ (thay cho form Sửa).
      descriptionEmpty: "—",
      descriptionPlaceholder: "Nhập mô tả…",
      // S5-TASK-BOARD-UX-1 — tiêu đề tạm của panel trượt phải trong lúc chờ tải task.
      drawer: {
        loading: "Đang tải công việc…",
      },
      fields: {
        project: "Dự án",
        assignee: "Người phụ trách",
        // S5-TASK-DETAIL-1 (GAP 3) — người giao việc (reporter), đủ 3 vai trên màn chi tiết.
        reporter: "Người giao việc",
        creator: "Người tạo",
        priority: "Ưu tiên",
        status: "Trạng thái",
        dueAt: "Deadline",
        startAt: "Bắt đầu",
        completedAt: "Hoàn thành lúc",
        description: "Mô tả",
      },
      quickActions: {
        title: "Thao tác nhanh",
      },
      comments: {
        title: "Bình luận",
        empty: "Chưa có bình luận nào.",
        placeholder: "Viết bình luận… (gõ @ để nhắc đến ai đó)",
        send: "Gửi",
        cancel: "Hủy",
        saveEdit: "Lưu",
        editAction: "Sửa bình luận",
        deleteAction: "Xóa bình luận",
        edited: "đã sửa",
        mention: {
          noMatch: "Không tìm thấy nhân viên phù hợp.",
          remove: "Bỏ nhắc {{name}}",
        },
        deleteDialog: {
          title: "Xóa bình luận",
          description: "Bình luận này sẽ bị xóa mềm. Bạn có chắc chắn?",
          confirm: "Xác nhận xóa",
          cancel: "Hủy",
        },
        errors: {
          loadFailed: "Không thể tải bình luận. Vui lòng thử lại.",
          validation: "Nội dung bình luận không hợp lệ.",
          forbidden: "Bạn không có quyền thực hiện thao tác này.",
          notFound: "Không tìm thấy bình luận hoặc công việc.",
          server: "Lỗi hệ thống. Vui lòng thử lại sau.",
          generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
        },
      },
      checklist: {
        title: "Checklist",
        addButton: "Thêm checklist",
        addItemPlaceholder: "Thêm hạng mục…",
        empty: "Chưa có checklist nào.",
        progress: "{{done}}/{{total}} hoàn thành ({{pct}}%)",
        requiredBadge: "Bắt buộc",
        deleteAction: "Xóa checklist",
        deleteItemAction: "Xóa hạng mục",
        createDialog: {
          title: "Thêm checklist",
          titlePlaceholder: "Tên checklist",
          confirm: "Thêm",
          cancel: "Hủy",
        },
        deleteDialog: {
          title: "Xóa checklist",
          description: 'Checklist "{{title}}" và các hạng mục sẽ bị xóa mềm. Bạn có chắc chắn?',
          confirm: "Xác nhận xóa",
          cancel: "Hủy",
        },
        errors: {
          loadFailed: "Không thể tải checklist. Vui lòng thử lại.",
          validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
          forbidden: "Bạn không có quyền thực hiện thao tác này.",
          notFound: "Không tìm thấy checklist hoặc công việc.",
          server: "Lỗi hệ thống. Vui lòng thử lại sau.",
          generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
        },
      },
      // S5-TASK-SUBTASK-1 (DECISIONS-05 D-31) — việc con 1 cấp (TaskSubtaskPanel), đứng TRÊN checklist
      // (phân rã công việc, khác hạng mục checklist trong đầu MỘT người).
      subtasks: {
        title: "Việc con",
        addButton: "Thêm việc con",
        empty: "Chưa có việc con nào.",
        progress: "{{done}}/{{total}} việc con hoàn thành ({{pct}}%)",
        belongsToParent: "Đây là việc con — thuộc công việc cha:",
        viewParentAction: "Xem công việc cha",
        unassigned: "Chưa giao",
        // D-39 — con actor không có phạm vi ĐỌC riêng (chỉ thấy qua thừa hưởng từ cha): ẩn link/nút.
        outOfScopeHint: "Bạn không có quyền xem chi tiết việc con này.",
        moveUp: "Đưa lên trên",
        moveDown: "Đưa xuống dưới",
        editAction: "Sửa nhanh việc con",
        // S5-TASK-INLINE-1 — sửa người thực hiện + hạn NGAY trên dòng việc con.
        inline: {
          assigneeAction: "Đổi người thực hiện (hiện tại: {{name}})",
          assigneeTitle: "Chọn người thực hiện",
          searchPlaceholder: "Tìm thành viên…",
          clearAssignee: "— Bỏ người thực hiện —",
          noMatch: "Không tìm thấy ai phù hợp.",
          dueAction: "Đổi hạn hoàn thành",
        },
        deleteAction: "Xóa việc con",
        fields: {
          title: "Tiêu đề",
          assignee: "Người thực hiện",
          dueAt: "Hạn hoàn thành",
        },
        addDialog: {
          title: "Thêm việc con",
          confirm: "Thêm",
          cancel: "Hủy",
          saving: "Đang lưu…",
        },
        editDialog: {
          title: "Sửa việc con",
          confirm: "Lưu",
          cancel: "Hủy",
          saving: "Đang lưu…",
        },
        deleteDialog: {
          title: "Xóa việc con",
          description: 'Việc con "{{title}}" sẽ bị xóa mềm. Bạn có chắc chắn?',
          confirm: "Xác nhận xóa",
          cancel: "Hủy",
        },
        errors: {
          loadFailed: "Không thể tải danh sách việc con. Vui lòng thử lại.",
          // S5-TASK-INLINE-1 — lỗi khi sửa nhanh trên dòng (không mở hộp thoại nên báo tại chỗ).
          saveFailed: "Không lưu được thay đổi. Vui lòng thử lại.",
          validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
          forbidden: "Bạn không có quyền thực hiện thao tác này.",
          notFound: "Không tìm thấy việc con hoặc công việc.",
          server: "Lỗi hệ thống. Vui lòng thử lại sau.",
          generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
        },
      },
      activity: {
        title: "Lịch sử hoạt động",
        empty: "Chưa có hoạt động nào.",
        systemActor: "Hệ thống",
        // S5-TASK-SUBTASK-1 (D-36) — nhãn dòng cũ→mới khi TASK_UPDATED đổi cha (activity-change.ts kind
        // "parentLink"); BE không enrich tên cha (chỉ ghi UUID) nên hiển thị nhãn cố định, KHÔNG raw id.
        parentLabel: "Việc con",
        errors: {
          loadFailed: "Không thể tải lịch sử hoạt động. Vui lòng thử lại.",
        },
        actions: {
          // S5-TASK-WORKSPACE-1 — nhóm project-level (feed dự án TASK-API-601, activity-labels.ts).
          projectCreated: "đã tạo dự án",
          projectUpdated: "đã cập nhật dự án",
          projectClosed: "đã đóng dự án",
          projectDeleted: "đã xóa dự án",
          memberAdded: "đã thêm thành viên",
          memberRoleChanged: "đã đổi vai trò thành viên",
          memberRemoved: "đã gỡ thành viên",
          taskCreated: "đã tạo công việc",
          taskUpdated: "đã cập nhật công việc",
          taskDeleted: "đã xóa công việc",
          taskAssigned: "đã giao việc",
          taskAssigneeChanged: "đã đổi người phụ trách",
          taskStatusChanged: "đã đổi trạng thái",
          taskStateChanged: "đã chuyển cột công việc",
          taskPriorityChanged: "đã đổi độ ưu tiên",
          taskDueDateChanged: "đã đổi deadline",
          taskWatcherAdded: "đã theo dõi công việc",
          taskWatcherRemoved: "đã bỏ theo dõi công việc",
          taskFileUploaded: "đã đính kèm tệp",
          taskFileDeleted: "đã gỡ tệp đính kèm",
          commentCreated: "đã bình luận",
          commentUpdated: "đã sửa bình luận",
          commentDeleted: "đã xóa bình luận",
          checklistCreated: "đã thêm checklist",
          checklistUpdated: "đã sửa checklist",
          checklistDeleted: "đã xóa checklist",
          checklistItemCreated: "đã thêm hạng mục checklist",
          checklistItemUpdated: "đã sửa hạng mục checklist",
          checklistItemDone: "đã hoàn thành hạng mục checklist",
          checklistItemDeleted: "đã xóa hạng mục checklist",
        },
      },
      actions: {
        more: "Thao tác khác",
        // Form đầy đủ giờ CHỈ còn cho các trường không có ô sửa tại chỗ (phòng ban, ngày bắt đầu).
        editMore: "Sửa thông tin khác",
        edit: "Sửa công việc",
        delete: "Xóa công việc",
      },
      deleteDialog: {
        title: "Xóa công việc",
        description: 'Công việc "{{title}}" sẽ bị xóa mềm. Bạn có chắc chắn?',
        confirm: "Xác nhận xóa",
        cancel: "Hủy",
      },
      notFound: {
        title: "Không tìm thấy công việc",
        description: "Công việc không tồn tại hoặc bạn không có quyền xem.",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem công việc này.",
      },
      error: {
        title: "Không thể tải công việc",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      // S4-FE-TASK-4 — TaskFilePanel (SPEC-06 §16.1/§9, GET/POST/DELETE /tasks/:taskId/files, S4-TASK-BE-5
      // PR #184 canonical). Mirror hr/employees files.* (EmployeeFilesTab) — cùng cấu trúc key.
      files: {
        title: "Tệp đính kèm",
        download: "Tải xuống",
        downloading: "Đang tải…",
        uploadButton: "Tải lên",
        uploadCategoryPlaceholder: "Phân loại (tuỳ chọn)",
        uploading: "Đang tải lên… {{percent}}%",
        uploadError: "Tải file lên thất bại. Vui lòng thử lại.",
        columns: {
          name: "Tên file",
          size: "Kích thước",
          category: "Phân loại",
          scanStatus: "Trạng thái quét",
          uploadedAt: "Ngày tải lên",
          actions: "Hành động",
        },
        scanStatus: {
          Clean: "Sạch",
          NotRequired: "Không cần quét",
          Pending: "Đang quét",
          Infected: "Nhiễm mã độc",
          Failed: "Quét thất bại",
        },
        empty: {
          title: "Chưa có file nào",
          description: "Tải lên file đính kèm cho công việc này.",
        },
        error: {
          description: "Không thể tải danh sách file. Vui lòng thử lại.",
        },
        forbidden: {
          title: "Không có quyền truy cập",
          description: "Bạn không có quyền xem tệp đính kèm của công việc này.",
        },
        cover: {
          set: "Đặt làm ảnh bìa",
          clear: "Gỡ ảnh bìa",
        },
        delete: {
          button: "Xóa",
          title: "Xóa tệp đính kèm",
          description:
            'Tệp "{{name}}" sẽ bị xóa mềm. Thao tác này không thể hoàn tác qua giao diện.',
          confirm: "Xác nhận xóa",
          deleting: "Đang xóa…",
          cancel: "Hủy",
          error: "Xóa tệp thất bại. Vui lòng thử lại.",
        },
      },
    },
    form: {
      createTitle: "Tạo công việc",
      editTitle: "Sửa công việc",
      fields: {
        title: "Tiêu đề",
        description: "Mô tả",
        project: "Dự án",
        assignee: "Người phụ trách",
        department: "Phòng ban",
        priority: "Ưu tiên",
        startAt: "Bắt đầu",
        dueAt: "Deadline",
      },
      placeholders: {
        none: "— Không chọn —",
      },
      // S5-TASK-MOVEPROJ-1 — form Sửa không đổi dự án (còn phải chọn cột đích) → chỉ đường.
      hints: {
        moveProject:
          'Đổi dự án bằng nút "Đổi dự án" ở đầu màn chi tiết (cần chọn cột trên bảng mới).',
      },
      errors: {
        titleRequired: "Tiêu đề là bắt buộc",
        dueBeforeStart: "Deadline không được sớm hơn thời điểm bắt đầu",
        conflict: "Dữ liệu bị xung đột. Vui lòng tải lại và thử lại.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
      },
      cancel: "Hủy",
      save: "Lưu",
      create: "Tạo",
      saving: "Đang lưu…",
    },
    assign: {
      label: "Người phụ trách",
      changeButton: "Đổi người phụ trách",
      saving: "Đang lưu…",
      employeeReadHint: "Bạn không có quyền xem danh sách nhân viên để chọn.",
      watchButton: "Theo dõi",
      // S5-TASK-DETAIL-1 (GAP 4) — list người theo dõi + bỏ theo dõi (self-only); key `watching`
      // (nút 1-trạng-thái cũ) đã GỠ — UI chuyển sang 2 nút Theo dõi/Bỏ theo dõi.
      unwatchButton: "Bỏ theo dõi",
      watchersTitle: "Người theo dõi ({{count}})",
      watchersEmpty: "Chưa có ai theo dõi công việc này.",
      watchersError: "Không thể tải danh sách người theo dõi.",
      watcherSelfSuffix: "(bạn)",
      watchHint:
        "Theo dõi để nhận cập nhật về công việc này (chỉ có thể tự theo dõi cho bản thân).",
      errors: {
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        notFound: "Không tìm thấy công việc hoặc nhân viên.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
      },
    },
    statusSelect: {
      statusLabel: "Trạng thái",
      priorityLabel: "Ưu tiên",
      deadlineLabel: "Deadline",
      errors: {
        conflict: "Không thể chuyển sang trạng thái này (vi phạm luồng công việc).",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
      },
    },
    status: {
      Todo: "Cần làm",
      "In Progress": "Đang làm",
      "In Review": "Chờ review",
      Done: "Hoàn thành",
      Cancelled: "Đã hủy",
    },
    priority: {
      Low: "Thấp",
      Medium: "Trung bình",
      High: "Cao",
      Urgent: "Khẩn cấp",
    },
    overdueBadge: "Quá hạn",
    // S4-FE-TASK-3 — Kanban board theo dự án (SPEC-06 §13.8, TASK-SCREEN-008). Mount trong tab "Kanban"
    // của ProjectDetailPage.
    kanban: {
      columnEmpty: "Không có công việc.",
      readOnlyHint: "Bạn chỉ có thể xem — không có quyền kéo-thả đổi trạng thái.",
      unassigned: "Chưa giao",
      // S5-TASK-BOARD-UX-1 — bấm thẻ mở panel chi tiết bên phải (nhãn cho trình đọc màn hình).
      openDetail: "Mở chi tiết công việc: {{title}}",
      // S5-TASK-CARDSUB-1 — nút trỏ xuống bung danh sách việc con ngay trên thẻ.
      subtaskList: {
        toggle: "Xem {{done}}/{{total}} việc con",
        empty: "Chưa có việc con.",
        loadFailed: "Không tải được việc con.",
      },
      // S5-TASK-BOARD-UX-1 — tạo nhanh đáy cột pipeline: gõ tiêu đề, Enter là tạo thẳng vào cột.
      quickCreate: {
        button: "Thêm công việc",
        placeholder: "Nhập tên công việc…",
        hint: "Enter để tạo · Esc để đóng",
        errors: {
          forbidden: "Bạn không có quyền tạo công việc ở cột này.",
          badRequest: "Không tạo được — kiểm tra lại tên công việc hoặc cột.",
          generic: "Không tạo được công việc. Vui lòng thử lại.",
        },
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem Kanban board.",
      },
      error: {
        title: "Không thể tải Kanban board",
        description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      empty: {
        title: "Chưa có công việc nào",
        description: "Dự án này chưa có công việc để hiển thị trên board.",
      },
      errors: {
        conflict: "Không thể chuyển sang trạng thái này (vi phạm luồng công việc).",
        forbidden: "Bạn không có quyền đổi trạng thái công việc này.",
        notFound: "Không tìm thấy công việc.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Đã xảy ra lỗi. Vui lòng thử lại.",
        // S5-TASK-PIPELINE-1 — kéo sang cột Hoàn thành khi checklist bắt buộc chưa xong (400) /
        // cột không hợp lệ: server từ chối, thẻ bật về chỗ cũ.
        badRequest: "Không thể chuyển cột — kiểm tra checklist bắt buộc hoặc cột đích.",
      },
      // S5-TASK-PIPELINE-1 (lane fe) — quản lý cột pipeline (SPEC-06 §6.8; gate *:project_state).
      manage: {
        button: "Quản lý cột",
        title: "Quản lý cột pipeline",
        name: "Tên cột",
        namePlaceholder: "Tên cột mới…",
        color: "Màu cột",
        sortOrder: "Thứ tự",
        group: "Nhóm trạng thái",
        default: "Mặc định",
        add: "Thêm cột",
        save: "Lưu",
        delete: "Xoá",
        empty: "Dự án chưa có cột pipeline.",
        groups: {
          backlog: "Backlog",
          unstarted: "Chưa bắt đầu",
          started: "Đang làm",
          review: "Chờ duyệt",
          completed: "Hoàn thành",
          cancelled: "Đã huỷ",
        },
        errors: {
          blocked: "Không thể thao tác — cột còn công việc hoặc dữ liệu không hợp lệ.",
          duplicate: "Tên cột đã tồn tại trong dự án.",
        },
      },
      // S5-FE-TASK-5 — badge tín hiệu trên card (SPEC-06 §13.8) + rail lọc theo assignee/"Chưa giao"
      // (suy từ tập task của board, không gọi API member mới).
      badges: {
        comments: "{{count}} bình luận",
        attachments: "{{count}} tệp đính kèm",
        checklist: "{{done}}/{{total}} hạng mục checklist hoàn thành",
        // S5-TASK-SUBTASK-1 — badge tiến độ việc con (D-34, mẫu số COUNTABLE_CHILD loại Cancelled).
        subtasks: "{{done}}/{{total}} việc con hoàn thành ({{pct}}%)",
      },
      // S5-TASK-WORKSPACE-1: nhóm filters.* cũ (rail đơn-chọn) đã gỡ — rail mới dùng workspace.rail.*.
    },
  },
  // S5-TASK-WORKSPACE-1 (đợt D1) — vỏ workspace dự án: toolbar lọc chung Bảng·Danh sách, rail avatar
  // multi-select, tab Hoạt động cấp dự án (TASK-API-601). Xuất khẩu ĐỂ LẠI đợt sau (cần cặp quyền
  // export:task + ghi activity log server-side theo SPEC-06 §14.19).
  workspace: {
    toolbar: {
      searchPlaceholder: "Tìm công việc theo tiêu đề…",
      sortLabel: "Sắp xếp",
      sort: {
        default: "Thứ tự mặc định",
        dueAsc: "Deadline gần nhất",
        dueDesc: "Deadline xa nhất",
        priorityDesc: "Ưu tiên cao trước",
        titleAsc: "Tiêu đề A→Z",
        createdDesc: "Mới tạo trước",
      },
      reset: "Đặt lại bộ lọc",
      columns: "Hiển thị",
      columnsTitle: "Cột hiển thị",
    },
    rail: {
      label: "Lọc theo người thực hiện",
      all: "Tất cả mọi người",
      assigneeTitle: "{{name}} — {{count}} công việc",
      unassignedTitle: "Chưa giao — {{count}} công việc",
    },
    list: {
      empty: {
        title: "Không có công việc nào khớp bộ lọc",
        description: "Thử đổi từ khóa hoặc đặt lại bộ lọc để xem toàn bộ công việc của dự án.",
      },
      truncated:
        "Đang hiển thị {{count}} công việc đầu của dự án — dùng bộ lọc để thu hẹp kết quả.",
    },
    activity: {
      title: "Lịch sử hoạt động của dự án",
      empty: "Dự án chưa có hoạt động nào.",
      errors: {
        loadFailed: "Không thể tải lịch sử hoạt động. Vui lòng thử lại.",
      },
      forbidden: {
        title: "Không có quyền xem lịch sử hoạt động",
        description: "Bạn cần quyền xem nhật ký công việc để mở tab này.",
      },
    },
  },
};
