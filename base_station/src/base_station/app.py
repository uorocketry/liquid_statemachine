def main() -> None:
    """Launch the local web dashboard."""
    from base_station.web.server import run

    run()


if __name__ == "__main__":
    main()
