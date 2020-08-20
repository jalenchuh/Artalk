import md5 from 'md5'
import '../css/list.less'
import Comment from './Comment'
import { ListData, CommentData } from '~/types/artalk-data'
import Artalk from '../Artalk'
import ArtalkContext from '../ArtalkContext'
import Utils from '../utils'

export default class List extends ArtalkContext {
  public el: HTMLElement
  public commentsWrapEl: HTMLElement

  public data: ListData
  public reqPageSize: number = 15 // 每次请求获取量

  public readMoreEl: HTMLElement
  public readMoreLoadingEl: HTMLElement
  public readMoreTextEl: HTMLElement

  public isLoading: boolean = false

  public closeCommentBtnEl: HTMLElement
  public openSidebarBtnEl: HTMLElement
  public openLinkBtnEl: HTMLElement

  constructor (artalk: Artalk) {
    super(artalk)

    this.el = Utils.createElement(require('../templates/List.ejs')(this))
    this.artalk.el.appendChild(this.el)

    this.commentsWrapEl = this.el.querySelector('.artalk-list-comments-wrap')

    // 操作按钮
    this.initListActionBtn()

    // 查看更多
    this.reqPageSize = this.artalk.conf.readMore ? (this.artalk.conf.readMore.pageSize || this.reqPageSize) : this.reqPageSize
    this.readMoreEl = this.el.querySelector('.artalk-list-read-more')
    this.readMoreLoadingEl = this.readMoreEl.querySelector('.artalk-loading-icon')
    this.readMoreTextEl = this.readMoreEl.querySelector('.artalk-text')

    this.readMoreEl.addEventListener('click', () => {
      this.readMore()
    })
  }

  /** 拉取评论 */
  public reqComments (offset: Number = 0) {
    if (offset === 0) {
      this.artalk.clearComments();
    }

    this.artalk.request('CommentGet', {
      page_key: this.artalk.conf.pageKey,
      limit: this.reqPageSize, // 获取评论数
      offset, // 偏移量
    }, () => {
      this.isLoading = true
      if (offset === 0) this.artalk.ui.showLoading()
      else this.readMoreBtnSetLoading(true)
    }, () => {
      this.isLoading = false
      if (offset === 0) this.artalk.ui.hideLoading()
      else this.readMoreBtnSetLoading(false)
    }, (msg, data: ListData) => {
      this.data = { ...data }
      this.artalk.ui.setGlobalError(null)
      this.reqImportComments(data.comments)
      // 查看更多按钮
      if (this.hasMoreComments) this.showReadMoreBtn()
      else this.hideReadMoreBtn()
      // 锚点跳转
      this.artalk.checkGoToCommentByUrlHash()
      // 滚动到底部自动加载
      if (offset === 0 && this.hasMoreComments) {
        this.initScrollBottomAutoLoad()
      }
    }, (msg, data) => {
      if (offset === 0) {
        const errEl = Utils.createElement(`<span>${msg}，无法获取评论列表数据<br/></span>`)
        const retryBtn = Utils.createElement('<span style="cursor:pointer">点击重新获取</span>')
        retryBtn.addEventListener('click', () => {
          this.reqComments(0)
        })
        errEl.appendChild(retryBtn)
        this.artalk.ui.setGlobalError(errEl)
      } else {
        this.readMoreBtnShowErr(`${msg} 获取失败`)
      }
    })
  }

  /** 导入评论 - 通过请求数据 */
  private reqImportComments (rawData: any[]) {
    if (!Array.isArray(rawData)) { throw new Error('请求响应参数非数组') }

    // 查找并导入所有子评论
    const queryImportChildren = (parentC: Comment) => {
      const children = rawData.filter(o => o.rid === parentC.data.id)
      if (children.length === 0) return

      children.forEach((itemData: CommentData) => {
        itemData.is_allow_reply = parentC.data.is_allow_reply
        const childC = new Comment(this.artalk, this, itemData)
        parentC.putChild(childC)

        queryImportChildren(childC); // 递归查找所有子评论
      })
    }

    // 开始处理 rawData
    rawData.filter((o) => o.rid === 0).forEach((rootCommentData: CommentData) => {
      if (rootCommentData.is_collapsed) rootCommentData.is_allow_reply = false
      const rootComment = new Comment(this.artalk, this, rootCommentData)
      this.artalk.comments.push(rootComment) // 将评论导入 comments 总表中

      this.commentsWrapEl.appendChild(rootComment.getElem())
      rootComment.playFadeInAnim()

      queryImportChildren(rootComment)
    })

    this.refreshUI(true)
  }

  /** 添加评论项 */
  public putRootComment (comment: Comment) {
    this.commentsWrapEl.prepend(comment.getElem())
    this.artalk.comments.unshift(comment)
  }

  private initListActionBtn () {
    // 侧边栏呼出按钮
    this.openSidebarBtnEl = this.el.querySelector('[data-action="open-sidebar"]')
    this.openSidebarBtnEl.addEventListener('click', () => {
      this.artalk.sidebar.show()
    })

    // 仓库链接按钮
    this.openLinkBtnEl = this.el.querySelector('[data-action="open-link"]')
    this.openLinkBtnEl.addEventListener('click', () => {
      window.open("https://github.com/qwqcode/Artalk", "Newwindow")
    })

    // 关闭评论按钮
    this.closeCommentBtnEl = this.el.querySelector('[data-action="admin-close-comment"]') as HTMLElement
    this.closeCommentBtnEl.addEventListener('click', () => {
      this.adminSetPage({
        is_close_comment: !this.data.page.is_close_comment
      })
    })
  }

  /** 刷新界面 */
  public refreshUI (isFirstUse: boolean = false) {
    (this.el.querySelector('.artalk-comment-count-num') as HTMLElement).innerText = this.getListCommentCount().toString()

    let noCommentElem = this.commentsWrapEl.querySelector('.artalk-no-comment') as HTMLElement
    if (this.artalk.comments.length <= 0 && !noCommentElem) {
      noCommentElem = Utils.createElement('<div class="artalk-no-comment"></div>')
      noCommentElem.innerText = this.artalk.conf.noComment
      this.commentsWrapEl.appendChild(noCommentElem)
    }
    if (this.artalk.comments.length > 0 && noCommentElem !== null) {
        noCommentElem.remove()
    }

    // 已输入个人信息
    if (!!this.artalk.user.data.nick && !!this.artalk.user.data.email) {
      this.openSidebarBtnEl.classList.remove('artalk-hide')
    } else {
      this.openSidebarBtnEl.classList.add('artalk-hide')
    }

    // 仅管理员显示控制
    this.el.querySelectorAll('[data-list-ui-only-admin]').forEach((itemEl: HTMLElement) => {
      if (this.artalk.user.data.isAdmin)
        itemEl.classList.remove('artalk-hide')
      else
        itemEl.classList.add('artalk-hide')
    })

    // 关闭评论
    if (!!this.data && !!this.data.page && this.data.page.is_close_comment === true) {
      this.artalk.editor.closeComment()
      this.closeCommentBtnEl.innerHTML = '打开评论'
    } else if (!isFirstUse) {
      this.artalk.editor.openComment()
      this.closeCommentBtnEl.innerHTML = '关闭评论'
    }
  }

  /** 获取评论总数 (包括子评论) */
  public getListCommentCount (): number {
    if (!this.data || !this.data.total) return 0
    return Number(this.data.total || '0')
  }

  /** 是否还有更多的评论 */
  get hasMoreComments (): boolean {
    if (!this.data) return false
    return this.data.total_parents > (this.data.offset + this.data.limit)
  }

  /** 阅读更多操作 */
  readMore () {
    const offset = this.data.offset + this.reqPageSize
    this.reqComments(offset)
  }

  /** 阅读更多按钮 - 显示 */
  showReadMoreBtn () {
    this.readMoreEl.style.display = ''
  }

  /** 阅读更多按钮 - 隐藏 */
  hideReadMoreBtn () {
    this.readMoreEl.style.display = 'none'
  }

  /** 阅读更多按钮 - 显示加载 */
  readMoreBtnSetLoading (isLoading: boolean) {
    this.showReadMoreBtn()
    this.readMoreLoadingEl.style.display = isLoading ? '' : 'none'
    this.readMoreTextEl.style.display = isLoading ? 'none' : ''
  }

  /** 阅读更多按钮 - 显示错误 */
  readMoreBtnShowErr (errMsg: string) {
    this.readMoreBtnSetLoading(false)

    const readMoreTextOrg = this.readMoreTextEl.innerText
    this.readMoreTextEl.innerText = errMsg
    this.readMoreEl.classList.add('artalk-err')
    setTimeout(() => {
      this.readMoreTextEl.innerText = readMoreTextOrg
      this.readMoreEl.classList.remove('artalk-err')
    }, 2000) // 2s后错误提示复原
  }

  /** 初始化滚动到底部自动查看更多（若开启） */
  initScrollBottomAutoLoad () {
    if (!this.artalk.conf.readMore) return
    if (!this.artalk.conf.readMore.autoLoad) return

    document.addEventListener('scroll', () => {
      const targetEl = this.el.querySelector('.artalk-list-comments-wrap > .artalk-comment-wrap:nth-last-child(3)') // 获取倒数第3个评论元素
      if (!targetEl) return
      if (!this.hasMoreComments) return
      if (this.isLoading) return
      if (this.artalk.ui.isVisible(targetEl as HTMLElement)) {
        // 加载更多
        this.readMore()
      }
    })
  }

  /** 根据请求数据判断 nick 是否为管理员 */
  public checkNickEmailIsAdmin (nick: string, email: string) {
    if (!this.data || !this.data.admin_nicks || !this.data.admin_encrypted_emails) return false

    return (this.data.admin_nicks.indexOf(nick) !== -1)
      && (this.data.admin_encrypted_emails.find(o => String(o).toLowerCase() === String(md5(email)).toLowerCase()))
  }

  /** 管理员设置页面信息 */
  public adminSetPage (conf: {
    is_close_comment: boolean
  }) {
    this.artalk.request('SetPage', {
      nick: this.artalk.user.data.nick,
      email: this.artalk.user.data.email,
      page_key: this.artalk.conf.pageKey,
      password: this.artalk.user.data.password,
      is_close_comment: Number(conf.is_close_comment)
    }, () => {
      this.artalk.ui.showLoading(this.artalk.editor.el)
    }, () => {
      this.artalk.ui.hideLoading(this.artalk.editor.el)
    }, (msg, data) => {
      this.data.page = { ...data }
      this.refreshUI()
    }, (msg, data) => {
      this.artalk.editor.showNotify(`修改页面数据失败：${msg}`, 'e')
    })
  }
}
