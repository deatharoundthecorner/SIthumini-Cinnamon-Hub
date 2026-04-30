import React from 'react'

interface State {
  hasError: boolean
  error?: Error | null
}

class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log error for debugging; apps can replace this with a reporting call
    // eslint-disable-next-line no-console
    console.error('Unhandled error caught by ErrorBoundary:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-xl text-center bg-white rounded-2xl p-8 shadow">
            <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
            <p className="text-gray-600 mb-4">An unexpected error occurred. You can reload the page or contact support.</p>
            <div className="flex items-center justify-center gap-4">
              <button onClick={this.handleReload} className="px-4 py-2 bg-[#8B4513] text-white rounded">Reload</button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children ?? null
  }
}

export default ErrorBoundary
